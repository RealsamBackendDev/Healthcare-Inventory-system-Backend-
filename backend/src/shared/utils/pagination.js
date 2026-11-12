const { PAGINATION } = require('../constants');

const getPagination = (query = {}) => {
  const rawPage = Number.parseInt(query.page, 10);
  const rawPageSize = Number.parseInt(query.pageSize, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : PAGINATION.DEFAULT_PAGE;
  const requestedSize = Number.isFinite(rawPageSize) && rawPageSize > 0 ? rawPageSize : PAGINATION.DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(requestedSize, PAGINATION.MAX_PAGE_SIZE);
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    limit: pageSize
  };
};

const buildPaginationMeta = ({ page, pageSize, total }) => ({
  page,
  pageSize,
  total,
  totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0
});

module.exports = {
  getPagination,
  buildPaginationMeta
};
