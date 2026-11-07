import {forReply,prepareTurn,resolveChoice,saveIntent} from './turn-context.js';
import fs from 'node:fs';
import {randomUUID, createHash} from 'node:crypto';
import {openStore, recall, addMessage, addNotes, resume, transaction, previousEvidence, reviewEntries} from './dialogue-store.js';

const root = process.cwd();
const action = process.argv[2];
let db;
try {
 const input = JSON.parse(fs.readFileSync(0,'utf8').trim() || '{}');
 const chat = input.chat ?? (process.env.CODEX_THREAD_ID && 'codex:'+process.env.CODEX_THREAD_ID);
 if (typeof chat!=='string' || !/^(codex|dsh|local):[^\s]{1,200}$/u.test(chat)) throw Error('需要稳定的宿主会话 ID。无宿主 ID 的客户端应生成并保存独立的 local:UUID');
 if (chat.startsWith('dsh:') && ['open','consider','finish'].includes(action)) throw Error('桌面会话的对话原文由桌面插件接管');
 db=openStore(root);
 let result;
 if (action==='context') result=recall(db,chat,input.query,Boolean(input.archive));
 else if (action==='review') result=reviewEntries(db,input.after);
 else if (action==='message') {
  result=db.prepare('SELECT mid,role,body FROM messages WHERE chat=? AND mid=?').get(chat,input.mid);
  if(!result)throw Error('该会话中没有这条消息');
 } else if (action==='sessions' && input.query) {
  result=db.prepare('SELECT chat,mid,substr(body,max(1,instr(body,?)-32),100) AS excerpt FROM messages WHERE instr(body,?)>0 ORDER BY n DESC LIMIT 20').all(input.query,input.query);
 } else if (action==='sessions') result=db.prepare("SELECT chat, max(n) AS lastMessage FROM messages GROUP BY chat ORDER BY lastMessage DESC").all().concat(db.prepare("SELECT DISTINCT scope AS chat FROM entries WHERE scope LIKE '历史:%'").all());
 else if (action==='resume') {resume(db,chat,input.from);result=recall(db,chat,input.query);}
 else if (action==='open') {
  result=transaction(db,()=>{
   const pending=db.prepare("SELECT mid,body FROM messages WHERE chat=? AND role='user' ORDER BY n DESC LIMIT 1").get(chat);
   const unfinished=pending && !db.prepare('SELECT 1 FROM receipts WHERE chat=? AND turn=?').get(chat,pending.mid);
   const turn=input.turn ?? (unfinished && pending.body===input.text ? pending.mid : randomUUID());
   addMessage(db,chat,turn,'user',input.text);
   const recalled=recall(db,chat,input.text,Boolean(input.archive));
   return {turn,...forReply(recalled),attention:prepareTurn(db,chat,input.text,recalled)};
  });
 } else if (action==='consider') {
  result=transaction(db,()=>{
   const user=db.prepare("SELECT mid,body FROM messages WHERE chat=? AND role='user' ORDER BY n DESC LIMIT 1").get(chat);
   if (!user || user.mid!==input.turn || db.prepare('SELECT 1 FROM receipts WHERE chat=? AND turn=?').get(chat,user.mid)) throw Error('只能准备本场尚未完成的最新回合');
   const frame=prepareTurn(db,chat,user.body,recall(db,chat,user.body));
   const choice=resolveChoice(db,frame,user.body,input.choice);
   db.prepare('INSERT OR REPLACE INTO pending_choices(chat,turn,intent) VALUES(?,?,?)').run(chat,user.mid,choice.intent);
   return choice;
  });
 } else if (action==='work-fact') {
  if(chat.startsWith('dsh:'))throw Error('工作模式的桌面记录由插件处理');
  const {quote,slot=''}=input;
  const mid='work:'+createHash('sha256').update(JSON.stringify([input.turn,quote])).digest('hex');
  transaction(db,()=>addNotes(db,chat,[{kind:'事实',mid,quote,slot}],[{role:'user',mid,text:input.text}]));
  result={saved:true};
 } else if (action==='finish') {
  result=transaction(db,()=>{
   const user=db.prepare("SELECT body FROM messages WHERE chat=? AND mid=? AND role='user'").get(chat,input.turn);
   if(!user) throw Error('找不到本场对应的用户消息');
   const notes=input.notes??[];
   const hash=createHash('sha256').update(JSON.stringify([input.reply,notes])).digest('hex');
   const receipt=db.prepare('SELECT hash FROM receipts WHERE chat=? AND turn=?').get(chat,input.turn);
   if(receipt && receipt.hash!==hash) throw Error('此回合已按不同正文提交');
   if(!receipt){
    const mid='a:'+input.turn;
    addMessage(db,chat,mid,'assistant',input.reply);
    const messages=[{mid:input.turn,role:'user',text:user.body},{mid,role:'assistant',text:input.reply}];
    if(notes.some(n=>!['user','assistant',input.turn,mid].includes(n.mid))) messages.push(...previousEvidence(db,chat,input.turn));
    addNotes(db,chat,notes.map(n=>({...n,mid:n.mid==='user'?input.turn:n.mid==='assistant'?mid:n.mid})),messages);
    const pending=db.prepare('SELECT intent FROM pending_choices WHERE chat=? AND turn=?').get(chat,input.turn);
    if(pending){
     const latest=db.prepare("SELECT mid FROM messages WHERE chat=? AND role='user' ORDER BY n DESC LIMIT 1").get(chat);
     if(latest.mid===input.turn) saveIntent(db,chat,mid,pending.intent);
     db.prepare('DELETE FROM pending_choices WHERE chat=? AND turn=?').run(chat,input.turn);
    }
    db.prepare('INSERT INTO receipts VALUES(?,?,?)').run(chat,input.turn,hash);
   }
   return {saved:true,turn:input.turn};
  });
 } else throw Error('支持 open、consider、finish、work-fact、context、review、message、sessions、resume');
 process.stdout.write(JSON.stringify(result)+'\n');
} catch (error) {console.error(error.message);process.exitCode=1;} finally {db?.close();}
