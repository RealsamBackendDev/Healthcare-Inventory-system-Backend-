const fs = require('fs');
const edits = [];
edits.push({
  file: 'src/modules/dispensing/dispensing.repository.js',
  from: [
    '    `SELECT id, code, name, unit_of_measure, is_active',
    '       FROM drugs',
    '      WHERE healthcare_centre_id = $1 AND id = ANY($2::uuid[])`,'
  ].join('\n'),
  to: [
    '    `SELECT d.id, d.code, d.name, d.unit_of_measure, d.is_active',
    '       FROM drugs d',
    '       JOIN healthcare_centres hc ON hc.id = $1',
    '      WHERE d.local_government_id = hc.local_government_id',
    '        AND d.id = ANY($2::uuid[])`,'
  ].join('\n')
});
edits.push({
  file: 'src/modules/drugs/drugs.repository.js',
  from: [
    'const findById = async (healthcareCentreId, drugId) => {',
    '  const { rows } = await query('
  ].join('\n'),
  to: [
    'const findById = async (healthcareCentreId, drugId, client) => {',
    '  const executor = client || { query };',
    '  const { rows } = await executor.query('
  ].join('\n')
});
edits.push({
  file: 'src/modules/drugs/drugs.service.js',
  from: 'const drug = await repository.findById(healthcareCentreId, created.id);',
  to: 'const drug = await repository.findById(healthcareCentreId, created.id, client);'
});
edits.push({
  file: 'src/modules/drugs/drugs.service.js',
  from: 'const updated = await repository.findById(healthcareCentreId, drugId);',
  to: 'const updated = await repository.findById(healthcareCentreId, drugId, client);'
});
const transitIn = [
  '',
  '      await repository.insertMovement(client, {',
  '        healthcareCentreId: destination.healthcareCentreId,',
  '        drugId: batch.drug_id,',
  '        batchId: returnBatch.id,',
  '        movementType: \'transit_in\',',
  '        quantity,',
  '        reason: `Damaged stock in transit to ${destination.centreName}`,',
  '        actorId: actor.id,',
  '        actorName: actor.fullName,',
  '        sourceReference: batch.supplier_reference',
  '      });'
].join('\n');
edits.push({
  file: 'src/modules/damage/damage.service.js',
  from: [
    '        reason: `Damaged stock sent back to ${destination.centreName} - ${payload.note}`,',
    '        actorId: actor.id,',
    '        actorName: actor.fullName,',
    '        sourceReference: batch.supplier_reference',
    '      });'
  ].join('\n'),
  to: [
    '        reason: `Damaged stock sent back to ${destination.centreName} - ${payload.note}`,',
    '        actorId: actor.id,',
    '        actorName: actor.fullName,',
    '        sourceReference: batch.supplier_reference',
    '      });',
    transitIn
  ].join('\n')
});
const transitOut = [
  '    await repository.insertMovement(client, {',
  '      healthcareCentreId,',
  '      drugId: batch.drug_id,',
  '      batchId: batch.id,',
  '      movementType: \'transit_out\',',
  '      quantity: -quantity,',
  '      reason: `Returned damaged stock inspected and taken out of transit - ${payload.note}`,',
  '      actorId: actor.id,',
  '      actorName: actor.fullName,',
  '      sourceReference: batch.supplier_reference',
  '    });',
  '',
  ''
].join('\n');
edits.push({
  file: 'src/modules/damage/damage.service.js',
  from: [
    '    await repository.updateBatchQuantity(client, {',
    '      batchId: batch.id,',
    '      quantity: 0,'
  ].join('\n'),
  to: [
    transitOut + '    await repository.updateBatchQuantity(client, {',
    '      batchId: batch.id,',
    '      quantity: 0,'
  ].join('\n')
});
let failed = false;
const touched = new Map();
edits.forEach((edit, index) => {
  const current = touched.has(edit.file) ? touched.get(edit.file) : fs.readFileSync(edit.file, 'utf8');
  if (current.includes(edit.to)) {
    console.log(`patch ${index + 1} already applied`);
  } else if (!current.includes(edit.from)) {
    console.log(`patch ${index + 1} FAILED - anchor not found in ${edit.file}`);
    failed = true;
  } else {
    touched.set(edit.file, current.split(edit.from).join(edit.to));
    console.log(`patch ${index + 1} applied to ${edit.file}`);
  }
});
if (failed) { process.exit(1); }
touched.forEach((text, file) => fs.writeFileSync(file, text));
console.log('BACKEND_FIXES_APPLIED');
