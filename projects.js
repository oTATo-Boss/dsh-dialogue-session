import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {withinProject,readSource} from './context.js';
export const projectKey=root=>createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0,24);
const markers=['AGENTS.md','CLAUDE.md','package.json','pyproject.toml','Cargo.toml','go.mod'];
export function discoverProject(cwd,excluded=[]){
 let current;try{current=fs.realpathSync(cwd);if(!fs.statSync(current).isDirectory())return null;}catch{return null;}
 if(excluded.some(root=>withinProject(root,current)))return null;
 const home=fs.realpathSync(os.homedir());let candidate=null;
 while(current!==home&&current!==path.dirname(current)){
  if(fs.existsSync(path.join(current,'.git')))return current;
  if(!candidate&&markers.some(file=>fs.existsSync(path.join(current,file))))candidate=current;
  current=path.dirname(current);
 }
 return candidate;
}
function boundedRead(file,max=262144){if(!fs.existsSync(file))return '';if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw new Error('Unsafe record file');const text=fs.readFileSync(file,'utf8');if(Buffer.byteLength(text)>max)throw new Error('Project records exceed safe injection limit');return text;}
export function projectContext(root,cwd,store){
 if(!withinProject(root,cwd))throw new Error('Project cwd escapes its root');
 const files=new Set(['AGENTS.md','CLAUDE.md','SKILLS_INDEX.md','README.md']);
 const relative=path.relative(fs.realpathSync(root),fs.realpathSync(cwd));let dir='';
 for(const part of relative.split(path.sep).filter(Boolean)){dir=path.join(dir,part);for(const name of ['AGENTS.md','CLAUDE.md','SKILLS_INDEX.md'])files.add(path.join(dir,name));}
 let output='当前项目：'+root+'。以下规则与项目记录由运行时每步从源文件读取，压缩后仍重新装配。按用户当前授权与项目规则选择技能、查阅任务相关文档、验证实际结果并记录重要结论。自动记录仅保存有用户原话支撑的约束和决定；工作成果、验证和进度仍按项目要求记录，不得虚报完成。其他项目的规则和记录不适用于本项目。\n';
 for(const file of files){const text=readSource(root,file);if(text)output+='\n--- '+file+' ---\n'+text+'\n';}
 const records=boundedRead(path.join(store,'records.md'));
 if(records)output+='\n--- 本项目自动记录（用户原话，按时间排列，最新纠正优先） ---\n'+records;
 if(Buffer.byteLength(output)>196608)throw new Error('Project context exceeds 192 KiB; review project document selection');
 return output;
}
export function recordEvidence(store,source,raw){
 const data=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
 if(!data||Array.isArray(data)||typeof data!=='object'||Object.keys(data).some(k=>!['facts','pending'].includes(k)))throw new Error('Unexpected project record schema');
 const items=[];
 for(const key of ['facts','pending']){
  if(!Array.isArray(data[key])||data[key].length>12)throw new Error('Invalid project record array');
  for(const item of data[key]){const quote=item?.quote;if(typeof quote!=='string'||quote.trim().length<3||quote.length>4000||/[\r\n]/.test(quote)||!source.userTexts.some(t=>t.includes(quote)))throw new Error('Unverified project record quote');items.push({kind:key,quote});}
 }
 fs.mkdirSync(store,{recursive:true,mode:0o700});const file=path.join(store,'records.md');let existing=boundedRead(file),addition='';
 for(const item of items){const origin=source.userMessages?.findLast(m=>m.text.includes(item.quote))?.seq??source.seq;const id=createHash('sha256').update(source.sessionId+':'+origin+':'+item.kind+':'+item.quote).digest('hex').slice(0,20);if(existing.includes('dsh-record:'+id))continue;
  const line='\n- '+new Date().toISOString()+'｜'+(item.kind==='pending'?'待确认':'明确约束/决定')+'｜'+item.quote+' <!-- dsh-record:'+id+' -->\n';addition+=line;existing+=line;
 }
 if(Buffer.byteLength(existing)>262144)throw new Error('Project records need consolidation; retain cursor');
 if(addition)fs.appendFileSync(file,addition,{encoding:'utf8',mode:0o600});
 return {writes:addition?1:0};
}
