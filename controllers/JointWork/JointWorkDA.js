const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

exports.mine = (UserId, From, To) => customQuery(sql.MINE(), { UserId, From, To });
exports.byId = async (JointWorkId) => (await customQuery(sql.BY_ID(), { JointWorkId }))[0] || null;
exports.pendingFor = async (UserId, Today) => (await customQuery(sql.PENDING_FOR(), { UserId, Today }))[0]?.n || 0;
exports.dayColleagues = async (UserId, WorkDate) => (await customQuery(sql.DAY_COLLEAGUES(), { UserId, WorkDate })).map((row) => row.ColleagueUserId);
exports.request = (rows) => runInTransaction(rows.map((inputs) => ({ sqlQuery: sql.REQUEST(), inputs })));
exports.respond = (inputs) => runInTransaction([{ sqlQuery: sql.RESPOND(), inputs }]);
exports.feedback = (inputs) => runInTransaction([{ sqlQuery: sql.FEEDBACK(), inputs }]);
exports.cancel = (inputs) => runInTransaction([{ sqlQuery: sql.CANCEL(), inputs }]);

// Transaction steps used by the visit save.
exports.requestQuery = (inputs) => ({ sqlQuery: sql.REQUEST(), inputs });
exports.visitWorkerQuery = (inputs) => ({ sqlQuery: sql.ADD_VISIT_WORKER(), inputs });
