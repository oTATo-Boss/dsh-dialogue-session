import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const privateDir = '对话/私有数据';
const durable = new Set(['事实','边界','约定','观察','经历','待确认','未完']);
const sceneFields = new Set(['情境','她的意图','刚发生的变化','悬着的事','场景状态']);
const segmenter = new Intl.Segmenter('zh', {granularity:'word'});

const common = new Set('一个 这个 那个 什么 这样 那样 怎么 觉得 今天 就是 好像 时候 可以 继续 已经 自己 刚才 现在 然后 还是 我们 你们 他们 真的 一点 一下 这里 那里 用户 以后'.split(' '));
function words(text) {
 const tokens=new Set();
 for(const word of segmenter.segment(text.toLowerCase())){
  if(word.isWordLike && word.segment.length>1 && !common.has(word.segment))tokens.add(word.segment);
 }
 return tokens;
}

export function transaction(db, fn) {
 db.exec('BEGIN IMMEDIATE');
 try { const result = fn(); db.exec('COMMIT'); return result; }
 catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function openStore(root) {
 const folder = path.join(root,privateDir);
 fs.mkdirSync(folder,{recursive:true,mode:0o700});
 if (fs.realpathSync(folder) !== path.join(fs.realpathSync(root),privateDir)) throw Error('数据目录不能指向项目外或软链接');
 const file = path.join(folder,'关系.sqlite');
 if (fs.lstatSync(file,{throwIfNoEntry:false})?.isSymbolicLink()) throw Error('数据库不能是软链接');
 const db = new DatabaseSync(file);
 try {
  fs.chmodSync(file,0o600);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS messages(n INTEGER PRIMARY KEY,chat TEXT NOT NULL,mid TEXT NOT NULL,role TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(chat,mid));
   CREATE TABLE IF NOT EXISTS entries(n INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,body TEXT NOT NULL,origin TEXT NOT NULL,scope TEXT NOT NULL,slot TEXT NOT NULL DEFAULT '',stamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,replaced TEXT);
   CREATE INDEX IF NOT EXISTS entries_scope ON entries(scope,kind,slot);
   CREATE TABLE IF NOT EXISTS concerns(
    id TEXT PRIMARY KEY, topic TEXT NOT NULL, wish TEXT NOT NULL, quote TEXT NOT NULL,
    first_n INTEGER NOT NULL REFERENCES messages(n), last_n INTEGER NOT NULL REFERENCES messages(n),
    since_day TEXT NOT NULL, after_day TEXT NOT NULL, asked INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0);
   CREATE UNIQUE INDEX IF NOT EXISTS concerns_active_topic ON concerns(topic) WHERE closed=0;
   CREATE TABLE IF NOT EXISTS pending_choices(chat TEXT PRIMARY KEY,turn TEXT NOT NULL,intent TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS turn_intents(chat TEXT PRIMARY KEY,reply_n INTEGER NOT NULL,intent TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS receipts(chat TEXT,turn TEXT,hash TEXT,PRIMARY KEY(chat,turn));`);
  return db;
 } catch (error) {db.close();throw error;}
}

export function addMessage(db,chat,mid,role,text) {
 if (!chat || !mid || !['user','assistant'].includes(role) || typeof text !== 'string' || !text.trim()) throw Error('缺少会话、消息标识或正文');
 const saved=db.prepare('SELECT role,body FROM messages WHERE chat=? AND mid=?').get(chat,mid);
 if (saved && (saved.body!==text || saved.role!==role)) throw Error('同一消息标识的正文已改变');
 if (!saved) db.prepare('INSERT INTO messages(chat,mid,role,body) VALUES(?,?,?,?)').run(chat,mid,role,text);
}

// Previous messages may supply a quote when the user asks to remember an earlier exchange.
export function previousEvidence(db,chat,firstMid) {
 const rows=db.prepare(`SELECT mid,role,body AS text FROM messages WHERE chat=?
  AND n < COALESCE((SELECT n FROM messages WHERE chat=? AND mid=?),9223372036854775807)
  ORDER BY n DESC LIMIT 10`).all(chat,chat,firstMid);
 return rows.reverse().map(row=>({...row,text:row.text.slice(-2200),prior:true}));
}

export function reviewEntries(db,after=0) {
 if(!Number.isSafeInteger(after) || after<0)throw Error('条目游标无效');
 const rows=db.prepare(`SELECT n,id,kind,body AS text,origin AS source,slot,stamp AS date,scope
  FROM entries WHERE replaced IS NULL AND n>? AND (scope='shared' OR (scope='archive' AND kind='待确认'))
  ORDER BY n LIMIT 41`).all(after);
 const items=rows.slice(0,40);
 return {items,next:rows.length>items.length?items.at(-1).n:null};
}

const shanghaiDay = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
export function concernDay() { return shanghaiDay.format(new Date()); }

export function readConcerns(db,query='',greeting=false) {
 const today=concernDay(), terms=words(query);
 const rows=db.prepare(`SELECT c.id,c.topic,c.wish,c.quote,c.since_day AS since,c.after_day AS earliest,c.asked,
  m.chat || '/' || m.mid AS source,m.role FROM concerns c JOIN messages m ON m.n=c.first_n
  WHERE c.closed=0 ORDER BY c.last_n DESC`).all();
 return rows.map(r=>{
  const topic=r.topic+' '+r.wish;
  const matches=[...terms].filter(term=>topic.includes(term)).length;
  const available=(!r.earliest || r.earliest<=today);
  const spontaneous=available && !r.asked && r.since<today;
  return {r,matches,available,spontaneous};
 }).filter(x=>!greeting || x.spontaneous)
 .sort((a,b)=>b.matches-a.matches || Number(b.spontaneous)-Number(a.spontaneous))
 .slice(0,8).map(({r,spontaneous})=>({...r,canBringUp:spontaneous}));
}

function writeConcern(db,chat,item,msg) {
 const source=db.prepare('SELECT n FROM messages WHERE chat=? AND mid=?').get(chat,msg.mid);
 if(!source || msg.prior) throw Error('惦记的变更须有本轮已保存的原话');
 const {kind,slot,quote,text=quote,replaces,after=''}=item;
 if(kind==='惦记') {
  if(typeof slot!=='string' || !slot.trim() || slot.length>80 || typeof text!=='string' || !text.trim() || text.length>240 || quote.length>320)
   throw Error('惦记需要简短主题、她想知道的事和原话');
  if(after && (typeof after!=='string' || !/^\d{4}-\d\d-\d\d$/.test(after) || !Number.isFinite(Date.parse(after)) || new Date(after).toISOString().slice(0,10)!==after))
   throw Error('最早再提日期须为有效的 YYYY-MM-DD');
  const topic=slot.trim(),id=digest(JSON.stringify(['concern',chat,msg.mid,topic]));
  db.prepare('INSERT OR IGNORE INTO concerns(id,topic,wish,quote,first_n,last_n,since_day,after_day) VALUES(?,?,?,?,?,?,?,?)')
    .run(id,topic,text.trim(),quote,source.n,source.n,concernDay(),after);
  return;
 }
 const old=db.prepare('SELECT last_n,closed FROM concerns WHERE id=?').get(replaces??'');
 if(!old)throw Error('跟进或放下需要已有惦记的 ID');
 if(kind==='跟进' && msg.role!=='assistant')throw Error('跟进须引用角色实际问过的话');
 if(old.closed || source.n<old.last_n)return;
 const column=kind==='放下'?'closed':'asked';
 db.prepare('UPDATE concerns SET '+column+'=1,last_n=? WHERE id=?').run(source.n,replaces);
}

export function addNotes(db,chat,notes,messages) {
 if (!Array.isArray(notes) || notes.length>32) throw Error('记忆条目格式不正确');
 for (const item of notes) {
  const {kind,quote,slot='',text=quote,replaces=''}=item;
  const msg=messages.find(m=>m.mid===item.mid);
  if (!msg || typeof quote!=='string' || !quote.trim() || !msg.text.includes(quote)) throw Error('引文必须来自指定的真实消息');
  if (['惦记','跟进','放下'].includes(kind)) {writeConcern(db,chat,item,msg);continue;}
  if (!durable.has(kind) && kind!=='场景') throw Error('未知记录类型');
  const interpreted=['观察','经历','场景'].includes(kind);
  if (!interpreted && msg.role!=='user') throw Error('个人事实、约定和边界须有用户原话');
  if (kind==='场景' && !sceneFields.has(slot)) throw Error('未知场景字段');
  if (typeof text!=='string' || !text.trim() || text.length>2400 || typeof slot!=='string' || slot.length>120) throw Error('无效的内容或主题');
  const scope=kind==='场景'?chat:'shared';
  const origin=chat+'/'+msg.mid;
  const body=interpreted && text!==quote ? text+'〔'+msg.role+'原话：'+quote+'〕' : quote;
  const id=digest(JSON.stringify([origin,kind,slot,body,replaces]));
  if (db.prepare('SELECT 1 FROM entries WHERE id=?').get(id)) continue;
  // Historical quotations cannot supersede today's state or an active decision.
  if(msg.prior && (replaces || kind==='场景' || (slot && db.prepare('SELECT 1 FROM entries WHERE kind=? AND scope=? AND slot=? AND replaced IS NULL').get(kind,scope,slot))))throw Error('修订现行记录或本场状态时须引用本轮证据');
  if (replaces) {
   const prev=db.prepare('SELECT kind,scope,replaced FROM entries WHERE id=?').get(replaces);
   const legacyPending=prev?.scope==='archive' && prev.kind==='待确认' && ['事实','边界','约定'].includes(kind);
   if (!prev || (prev.scope!==scope && !legacyPending) || prev.replaced || msg.role!=='user' || (prev.kind==='边界' && kind!=='边界')) throw Error('修订需要有效的同范围前项及用户引文');
   db.prepare('UPDATE entries SET replaced=? WHERE id=?').run(id,replaces);
  }
  if (kind==='场景' || (slot && scope==='shared' && ['事实','约定','边界','未完'].includes(kind))) {
   db.prepare('UPDATE entries SET replaced=? WHERE scope=? AND kind=? AND slot=? AND replaced IS NULL').run(id,scope,kind,slot);
  }
  db.prepare('INSERT INTO entries(id,kind,body,origin,scope,slot) VALUES(?,?,?,?,?,?)').run(id,kind,body,origin,scope,slot);
 }
}

function selectRecords(db,query,archive,limit) {
 const terms=words(query);
 const phrase=query.trim().toLowerCase();
 if(phrase.length>=2 && phrase.length<=32 && !common.has(phrase)) terms.add(phrase);
 const rows=db.prepare("SELECT n,id,kind,body,origin,slot,stamp FROM entries WHERE scope=? AND replaced IS NULL ORDER BY n DESC").all(archive?'archive':'shared');
 const ranked=rows.map(r=>{
  const tokens=words(r.slot+' '+r.stamp+' '+r.body);
  let score=0;for(const term of terms) if(tokens.has(term)||r.body.includes(term)) score+=Math.min(term.length,6);
  return {r,score};
 });
 return ranked.filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.r.n-a.r.n).slice(0,limit).map(x=>x.r);
}

export function recall(db,chat,query='',archive=false) {
 const recent=db.prepare('SELECT mid,role,body FROM messages WHERE chat=? ORDER BY n DESC LIMIT 10').all(chat).reverse();
 const cues=[...recent.slice(-3).map(x=>x.body.slice(-220)),query].join(' ');
 const related=selectRecords(db,cues,false,6);
 const pinned=db.prepare("SELECT id,kind,body,origin,slot,stamp FROM entries WHERE scope='shared' AND kind IN ('边界','约定','未完') AND replaced IS NULL ORDER BY n DESC").all();
 const unique=new Map([...pinned,...related].map(r=>[r.id,{id:r.id,kind:r.kind,text:r.body,source:r.origin,date:r.stamp,slot:r.slot}]));
 return {chat,scene:db.prepare("SELECT slot,body,origin FROM entries WHERE scope=? AND kind='场景' AND replaced IS NULL ORDER BY n").all(chat),
 recent:recent.map(r=>({...r,body:r.body.slice(-2200)})),relationship:[...unique.values()],
 ...(archive?{history:selectRecords(db,query,true,6)}:{})};
}

export function resume(db,chat,from) {
 if (!from || from===chat || from==='shared' || from==='archive') throw Error('请指定另一场会话');
 return transaction(db,()=>{
  const old=recall(db,from);
  old.recent=db.prepare('SELECT mid,role,body FROM messages WHERE chat=? ORDER BY n DESC LIMIT 10').all(from).reverse();
  if(!old.scene.length && !old.recent.length)throw Error('未找到要接续的会话');
  const key='resume:'+from+':'+digest(JSON.stringify([old.recent.at(-1)?.mid,old.scene]));
  if(db.prepare('SELECT 1 FROM receipts WHERE chat=? AND turn=?').get(chat,key)) return;
  db.prepare("UPDATE entries SET replaced=? WHERE scope=? AND kind='场景' AND replaced IS NULL").run(key,chat);
  for(const row of old.scene) {
   const id=digest(chat+key+row.slot);
   db.prepare("UPDATE entries SET replaced=? WHERE scope=? AND kind='场景' AND slot=? AND replaced IS NULL").run(id,chat,row.slot);
   db.prepare("INSERT INTO entries(id,kind,body,origin,scope,slot) VALUES(?,'场景',?,?,?,?)").run(id,row.body,from+' → '+row.origin,chat,row.slot);
  }
  for(const m of old.recent) addMessage(db,chat,key+'/'+m.mid,m.role,m.body);
  db.prepare('INSERT INTO receipts VALUES(?,?,?)').run(chat,key,key);
 });
}
