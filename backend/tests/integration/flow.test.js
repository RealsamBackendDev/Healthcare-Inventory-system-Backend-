const request = require('supertest');
const app = require('../../src/app');
const environment = require('../../src/config/environment');
const { pool } = require('../../src/database/connection');

const describeIntegration = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;

describeIntegration('API workflows', () => {
  let adminToken;
  let drug;
  let receipt;
  const suffix = Date.now().toString().slice(-6);

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').send({
      email: environment.bootstrap.adminEmail,
      password: environment.bootstrap.adminPassword
    });
    expect(login.status).toBe(200);
    adminToken = login.body.data.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  test('health endpoint reports a connected database', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.data.database).toBe('connected');
  });

  test('rejects invalid credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: environment.bootstrap.adminEmail, password: 'definitely-wrong' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('rejects unauthenticated access', async () => {
    const response = await request(app).get('/api/inventory');
    expect(response.status).toBe(401);
  });

  test('creates a drug and receives two batches', async () => {
    const drugResponse = await request(app)
      .post('/api/drugs')
      .set(auth(adminToken))
      .send({
        code: `IT-${suffix}`,
        name: 'Integration Test Drug',
        strength: '250 mg',
        dosageForm: 'Tablet',
        unitOfMeasure: 'tablet',
        minimumStockLevel: 10
      });
    expect(drugResponse.status).toBe(201);
    drug = drugResponse.body.data;

    const receiptResponse = await request(app)
      .post('/api/receiving/receipts')
      .set(auth(adminToken))
      .send({
        supplier: 'Integration Supplier',
        items: [
          {
            drugId: drug.id,
            batchNumber: `ITB-${suffix}-LATE`,
            quantity: 40,
            expiryDate: '2030-12-31',
            unitCost: 2.5
          },
          {
            drugId: drug.id,
            batchNumber: `ITB-${suffix}-EARLY`,
            quantity: 10,
            expiryDate: '2029-01-31',
            unitCost: 2.5
          }
        ]
      });
    expect(receiptResponse.status).toBe(201);
    receipt = receiptResponse.body.data.receipt;
    expect(receipt.receiptReference).toBeTruthy();
  });

  test('dispenses across batches using the earliest expiry first', async () => {
    const response = await request(app)
      .post('/api/dispensing')
      .set(auth(adminToken))
      .send({ items: [{ drugId: drug.id, quantity: 25 }], note: 'Integration FEFO' });
    expect(response.status).toBe(201);
    const allocations = response.body.data.allocations;
    expect(allocations).toHaveLength(2);
    expect(allocations[0].batchNumber).toBe(`ITB-${suffix}-EARLY`);
    expect(allocations[0].quantity).toBe(10);
    expect(allocations[1].quantity).toBe(15);
  });

  test('rejects dispensing more than usable stock', async () => {
    const response = await request(app)
      .post('/api/dispensing')
      .set(auth(adminToken))
      .send({ items: [{ drugId: drug.id, quantity: 5000 }] });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  test('reports usable stock that reconciles with batches', async () => {
    const inventory = await request(app)
      .get(`/api/inventory/drugs/${drug.id}`)
      .set(auth(adminToken));
    expect(inventory.status).toBe(200);
    const total = inventory.body.data.batches.reduce((sum, batch) => sum + batch.quantity, 0);
    expect(total).toBe(25);
  });

  test('blocks staff from administrator endpoints', async () => {
    const email = `staff-${suffix}@test.local`;
    const created = await request(app)
      .post('/api/users')
      .set(auth(adminToken))
      .send({ fullName: 'Integration Staff', email, password: 'StaffPass123!', roleCode: 'STAFF' });
    expect(created.status).toBe(201);

    const login = await request(app).post('/api/auth/login').send({ email, password: 'StaffPass123!' });
    expect(login.status).toBe(200);

    const response = await request(app).get('/api/users').set(auth(login.body.data.token));
    expect(response.status).toBe(403);
  });
});
