// Serializes one embedded PostgreSQL connection so concurrent browser requests
// cannot interleave transaction-local roles. Production uses pg's real pool.
export function pglitePool(db) {
  let queue=Promise.resolve();
  async function acquire() {
    const previous=queue;
    let release;queue=new Promise(resolve=>{release=resolve;});
    await previous;return release;
  }
  async function query(sql,params) {
    if(params===undefined){const results=await db.exec(sql);return results.at(-1) || {rows:[]};}
    return db.query(sql,params);
  }
  const connect=async()=>{const release=await acquire();return {query,release};};
  return {connect,async query(sql,params){const connection=await connect();try{return await query(sql,params);}finally{connection.release();}}};
}
