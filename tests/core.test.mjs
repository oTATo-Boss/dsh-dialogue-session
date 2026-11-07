import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {modeFrom,taskForMode,withinProject,loadContext} from '../context.js';
import {openStore, addNotes, transaction, recall} from '../dialogue-store.js';
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'otato-core-'));for(const [file,text]of Object.entries({'AGENTS.md':'PROJECT_RULE','soul.md':'PERSONA','对话/规则.md':'1. 原有规则。','对话/调教协议.md':'PROTOCOL','对话/记忆/关系档案.md':'PROFILE','对话/记忆/收件箱.md':'# 收件箱\n\n## 待整理\n原有记录\n','对话/记忆/当前状态.md':'# 当前状态\n人工记录不能丢\n','对话/记忆/待确认.md':'# 待确认\n','对话/记忆/调教笔记.md':'# 调教笔记\n'})){const p=path.join(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}return root;}
const record=(facts=[])=>({facts,pending:[],rules:[],state:[]});
test('mode commands persist; quoted mode names do not switch',()=>{assert.equal(modeFrom('系统 开发模式 查问题','对话'),'开发');assert.equal(modeFrom('切回对话模式','开发'),'对话');assert.equal(modeFrom('我之前说过开发模式','工作'),'工作');assert.equal(modeFrom('继续','开发'),'开发');});
test('project boundaries reject prefix siblings and symlink escapes',()=>{const a=fixture();const b=fixture();fs.symlinkSync(b,path.join(a,'outside'));assert(withinProject(a,a));assert(!withinProject(a,a+'-other'));assert(!withinProject(a,path.join(a,'outside')));});
test('context reads current rule file, never stale cached copy',()=>{const root=fixture();assert(loadContext(root,'对话').includes('原有规则'));fs.writeFileSync(path.join(root,'对话/规则.md'),'新版本原文');assert(loadContext(root,'对话').includes('新版本原文'));assert(!loadContext(root,'开发').includes('PERSONA'));});
test('mode explanations and negations do not switch',()=>{assert.equal(modeFrom('开发模式 是什么意思？','对话'),'对话');assert.equal(modeFrom('开发模式，不是我现在要切换的模式','对话'),'对话');assert.equal(modeFrom('切换到开发模式 继续检查','对话'),'开发');});
test('evidence, revisions and per-chat scene are isolated and transactional',()=>{
 const db=openStore(fixture());
 try{
  const first={mid:'u:1',role:'user',text:'我喜欢紫色'},next={mid:'u:2',role:'user',text:'我现在更喜欢蓝色'};
  const fact={mid:first.mid,kind:'事实',slot:'颜色',quote:first.text,text:'已经搬家到上海'};
  transaction(db,()=>addNotes(db,'dsh:a',[fact,fact,{kind:'场景',slot:'情境',mid:first.mid,quote:first.text}],[first]));
  assert.throws(()=>transaction(db,()=>addNotes(db,'dsh:a',[{...fact,quote:'不存在的引文'}],[first])));
  transaction(db,()=>addNotes(db,'codex:b',[{...fact,mid:next.mid,quote:next.text}],[next]));
  const result=recall(db,'codex:b','颜色');
  assert.deepEqual(result.relationship.map(x=>x.text),[next.text]);assert.equal(result.scene.length,0);
  assert.equal(recall(db,'dsh:a').scene.length,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM entries WHERE slot='颜色'").get().n,2);
 }finally{db.close();}
});
test('chat media and formal work route to their respective sources', () => {
 const root = fixture();
 fs.mkdirSync(path.join(root, 'workflow'));
 fs.writeFileSync(path.join(root, 'workflow/image-workflow.md'), '正式制作才确认');
 fs.writeFileSync(path.join(root, '对话/出图.md'), '聊天媒体入口');
 assert(loadContext(root, '对话', 'image').includes('聊天媒体入口'));
 assert(!loadContext(root, '对话', 'image').includes('正式制作才确认'));
 assert(loadContext(root, '工作', 'image').includes('正式制作才确认'));
 assert(!loadContext(root, '工作', 'image').includes('PERSONA'));
});

test('dialogue replies drop an earlier media request, while work can continue one', () => {
 for (const reply of ['继续', '不够', '宝宝', '不玩了', '我刷到个视频']) {
  assert.equal(taskForMode(reply, '对话', 'video'), '');
 }
 assert.equal(taskForMode('发个视频给我', '对话'), 'video');
 assert.equal(taskForMode('想看一张私密照片', '对话'), 'private');
 assert.equal(taskForMode('继续', '工作', 'video'), 'video');
});
