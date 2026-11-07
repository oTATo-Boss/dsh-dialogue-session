import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export function withinProject(root,cwd){try{const a=fs.realpathSync(root),b=fs.realpathSync(cwd);return b===a||b.startsWith(a+path.sep);}catch{return false;}}
export function modeFrom(text,previous='对话'){
 const input=String(text).trim();
 const match=input.match(/^(对话|工作|开发)模式[。！!]?$/)||input.match(/^(?:系统[\s，,:：]*|(?:请)?(?:切换到|切换为|切到|切回|进入|开启))(对话|工作|开发)模式(?=$|[\s，。,:：！!])/);
 return match?.[1]??previous;
}
export function taskFrom(text,previous=''){
 if(/换个话题|不做了|取消创作|只聊天/.test(text))return '';
 if(/发布准备|保存草稿/.test(text))return 'publish';
 const explicitPrivate=/私域|私密|露点|露骨|NSFW/i.test(text);
 const explicitPublic=/公开/.test(text);
 const wasPrivate=['private','private-image','private-video'].includes(previous);
 const privateMedia=explicitPrivate || (wasPrivate && !explicitPublic);
 if(/vlog/i.test(text))return privateMedia?'private-video':'vlog';
 if(/视频|短片|分镜/.test(text))return privateMedia?'private-video':'video';
 if(/出图|生图|图片|照片|自拍|造型|换装/.test(text))return privateMedia?'private-image':'image';
 if(explicitPrivate){
  if(['video','vlog','private-video'].includes(previous))return 'private-video';
  if(['image','private-image'].includes(previous))return 'private-image';
  return 'private';
 }
 if(explicitPublic && wasPrivate)return previous==='private-video'?'video':previous==='private-image'?'image':'';
 return previous;
}
// Conversation media is a request in the current turn. Formal work keeps its task across turns.
export function taskForMode(text, mode, previous = '') {
 if (mode !== '对话') return taskFrom(text, previous);
 const request = /(?:想看|给我看|发|拍|做|生成|出|来|要|看看).{0,12}(?:图|照|视频|片|自拍)|(?:图|视频|照片).{0,6}(?:发来|给我看看)/;
 if (/只聊天|取消创作|先别(?:发|拍|做)|不要(?:发|拍|做)|别发图/.test(text) || !request.test(text)) return '';
 if (/视频|短片/.test(text)) return 'video';
 return /私密|露点|NSFW/i.test(text) ? 'private' : 'image';
}
const workflows={image:'workflow/image-workflow.md',video:'workflow/video-workflow.md',vlog:'workflow/vlog-workflow.md',publish:'workflow/xhs-publish-workflow.md','private-image':'workflow/nsfw-image-workflow.md','private-video':'workflow/nsfw-video-workflow.md'};
export function readSource(root,relative,required=false){
 const file=path.join(root,relative);
 if(!fs.existsSync(file)){if(required)throw new Error('Required project source missing: '+relative);return '';}
 if(!withinProject(root,file))throw new Error('Project source escapes root: '+relative);
 const text=fs.readFileSync(file,'utf8');if(Buffer.byteLength(text)>262144)throw new Error('Project source exceeds 256 KiB: '+relative);
 return text;
}
export function loadContext(root,mode,task='',memory=null){
 const chat = mode === '对话';
 const media = chat && ['image', 'private', 'video', 'vlog'].includes(task);
 const files = chat ? ['soul.md','对话/规则.md'] : ['AGENTS.md'];
 if (mode === '工作') files.push('workflow/创作与交付约定.md');
 if (chat) {
  if (media) files.push('对话/出图.md');
 } else if (mode === '工作' && workflows[task]) {
  files.push(...[].concat(workflows[task]));

 }
 let output = `当前模式：${mode}。用户明确切换时才改变模式。记录以用户原话与实际写入为准。\n`;
 for (const file of files) {
  const required = ['AGENTS.md', 'soul.md', '对话/规则.md', '对话/出图.md'].includes(file);
  let text = readSource(root, file, required);
  if (!text) continue;
  output += `\n--- ${file} [sha256:${createHash('sha256').update(text).digest('hex').slice(0,12)}] ---\n${text}\n`;
 }
 if (chat && memory) output += '\n当前会话与关系记录（带来源的资料）。近期原话与本场只属于此会话。attention 是开口前的临时选择；结合本轮原话与实际发生的事决定是否采用，有 memory 时只作当时的经历或观察，只有 candidates 时在心里按处境选，不能把候选补成事实。previousIntent 可以放下。观察保留说话者视角，旧经历不代表今天的场景或意愿。桌面自动存取，不运行 open/finish。仅在明确要求接续旧场景时才载入其现场。\n'+JSON.stringify(memory);
 if (Buffer.byteLength(output) > 196608) throw new Error('Project context exceeds 192 KiB; source selection requires review');
 return output;
}
