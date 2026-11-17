const {maxId} = require('../../public/js/app-config');

function errorResponse(res, status, code, message, fields = []) {
  return res.set('Cache-Control', 'no-store').status(status).json({error: {code, message, fields}});
}

const validId = value => /^[1-9]\d*$/.test(value)
  && Number.isSafeInteger(Number(value)) && Number(value) <= maxId;
const hasQuery = req => Boolean(new URL(req.originalUrl, 'http://frontend').search);
const isJsonObject = req => req.is('application/json') && req.body && typeof req.body === 'object' && !Array.isArray(req.body);

async function rejectUnusedParameters(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const reject = () => errorResponse(res, 422, 'INVALID_PARAMETERS', 'เส้นทางนี้ไม่รับ query หรือ body');
  if (hasQuery(req) || Number(req.get('content-length')) > 0) return reject();
  if (req.get('transfer-encoding')) {
    for await (const chunk of req.iterator({destroyOnReturn: false})) {
      if (chunk.length) {
        req.resume();
        return reject();
      }
    }
  }
  next();
}

module.exports = {errorResponse, validId, hasQuery, isJsonObject, rejectUnusedParameters};
