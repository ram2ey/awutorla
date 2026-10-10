// Same-origin PostgreSQL API. Session credentials stay in an HttpOnly cookie;
// cached metadata only supports device-local offline views.
export interface User {id:string;email:string;must_change_password:boolean}
export interface Session {user:User;expiresAt:string;profile:{id:string;role:string;full_name:string|null;phone_number:string|null}}
type Result = {data:any;error:Error|null;count?:number|null};
type Listener = (event:string,session:Session|null)=>void;
const listeners=new Set<Listener>();
const metadataKey='atelier-native-session';
let current:Session|null=null;

function cached():Session|null {
  try {
    const session=JSON.parse(localStorage.getItem(metadataKey) || 'null');
    return session && new Date(session.expiresAt).getTime()>Date.now() ? session : null;
  }catch{return null;}
}
function publish(event:string,session:Session|null) {
  current=session;
  try {if(session)localStorage.setItem(metadataKey,JSON.stringify(session));else localStorage.removeItem(metadataKey);}catch{/* Storage may be unavailable. */}
  listeners.forEach(listener=>listener(event,session));
}
async function request(path:string,body?:unknown,method='POST'):Promise<Result> {
  try {
    const response=await fetch(`/api${path}`,{method,credentials:'same-origin',cache:'no-store',
      headers:body instanceof Blob ? {} : {'Content-Type':'application/json'},
      body:method==='GET'?undefined:body instanceof Blob?body:JSON.stringify(body ?? {})});
    const result=await response.json();
    if(!response.ok || result.error) {
      if(response.status===401 && path!=='/auth/sign-in')publish('SIGNED_OUT',null);
      return {data:null,error:new Error(result.error?.message || 'Could not complete this request.'),count:null};
    }
    return {...result,error:null};
  } catch {
    return {data:null,error:new Error('Could not reach the workshop server. Check your connection.'),count:null};
  }
}

class Query implements PromiseLike<Result> {
  private spec:Record<string,any>;
  constructor(spec:Record<string,any>) {this.spec=spec;}
  private change(fields:Record<string,any>) {return new Query({...this.spec,...fields});}
  select(selection='*',options?:{count?:string;head?:boolean}) {return this.change({selection,...options});}
  eq(column:string,value:unknown) {return this.filter(column,'eq',value);}
  gte(column:string,value:unknown) {return this.filter(column,'gte',value);}
  in(column:string,value:unknown[]) {return this.filter(column,'in',value);}
  private filter(column:string,op:string,value:unknown) {return this.change({filters:[...(this.spec.filters || []),{column,op,value}]});}
  order(column:string,options?:{ascending?:boolean}) {return this.change({orders:[...(this.spec.orders || []),{column,ascending:options?.ascending ?? true}]});}
  range(start:number,end:number) {return this.change({offset:start,limit:end-start+1});}
  maybeSingle() {return this.change({single:'optional'});}
  single() {return this.change({single:'required'});}
  update(values:unknown) {return this.change({action:'update',values});}
  insert(values:unknown) {return this.change({action:'insert',values});}
  upsert(values:unknown,_options?:unknown) {return this.change({action:'upsert',values});}
  then<TResult1=Result,TResult2=never>(
    fulfilled?:((value:Result)=>TResult1|PromiseLike<TResult1>)|null,
    rejected?:((reason:any)=>TResult2|PromiseLike<TResult2>)|null
  ):PromiseLike<TResult1|TResult2> {
    if(typeof navigator!=='undefined' && !navigator.onLine && this.spec.table==='profiles' &&
      !this.spec.action && this.spec.filters?.some((filter:any)=>filter.column==='id' && filter.op==='eq' && filter.value===current?.user.id)) {
      return Promise.resolve({data:current?.profile || null,error:null}).then(fulfilled,rejected);
    }
    return request('/query',this.spec).then(fulfilled,rejected);
  }
}

export const api={
  from:(table:string)=>new Query({table}),
  rpc:(name:string,args:Record<string,unknown>={})=>request('/rpc',{name,args}),
  functions:{invoke:(name:string,options:{body:unknown})=>
    request(name==='create-staff-account'?'/staff/create':name==='reset-staff-password'?'/staff/reset-password':'/unsupported',options.body)},
  storage:{from:(_bucket:string)=>({
    upload:(path:string,file:File,_options?:unknown)=>request(`/files?path=${encodeURIComponent(path)}`,file),
    createSignedUrl:(path:string,_seconds:number)=>request('/files/url',{path}),
    remove:(paths:string[])=>request('/files',{paths},'DELETE'),
  })},
  auth:{
    async getSession() {
      if(typeof navigator!=='undefined' && !navigator.onLine) {current=cached();return {data:{session:current},error:null};}
      const result=await request('/auth/session',undefined,'GET');
      current=result.data;
      if(!result.error)publish('INITIAL_SESSION',current);
      return {data:{session:current},error:result.error};
    },
    onAuthStateChange(listener:Listener) {listeners.add(listener);return {data:{subscription:{unsubscribe:()=>listeners.delete(listener)}}};},
    async signInWithPassword(details:{email:string;password:string}) {
      const result=await request('/auth/sign-in',details);
      if(!result.error)publish(result.data.user.must_change_password?'PASSWORD_RECOVERY':'SIGNED_IN',result.data);
      return {data:{user:result.data?.user,session:result.data},error:result.error};
    },
    async signOut() {
      const result=await request('/auth/sign-out');
      if(result.error)throw result.error;
      publish('SIGNED_OUT',null);
      return result;
    },
    async updateUser(details:{password:string}) {
      const result=await request('/auth/password',details);
      if(!result.error)publish('USER_UPDATED',result.data);
      return result;
    },
    async resetPasswordForEmail(_email:string,_options?:unknown) {
      return {error:new Error('Ask a workshop admin for a temporary password. Reset emails are not used.')};
    },
  },
};

if(typeof window!=='undefined') window.addEventListener('storage',event=>{
  if(event.key===metadataKey) {current=cached();listeners.forEach(listener=>listener(current?'SIGNED_IN':'SIGNED_OUT',current));}
});
