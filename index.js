import fs from 'node:fs';
import z from '@deepseek-ai/schemastery';
import * as specialized from './specialized.js';
import * as generic from './generic.js';
export const name='otato-dialogue-bundle';
export const inject=['systemPrompt','agents','llm'];
export const Config=z.object({projectRoot:z.string().default(''),excludedRoots:z.array(z.string()).default([]),stateDir:z.string().default(''),autoProjects:z.boolean().default(true),genericStateDir:z.string().default('')});
export async function apply(ctx,config){
 const excludedRoots=(config.excludedRoots ?? []).filter(p=>fs.existsSync(p)).map(p=>fs.realpathSync(p));
 if(config.projectRoot&&fs.existsSync(config.projectRoot)){
  const root=fs.realpathSync(config.projectRoot);excludedRoots.push(root);
  await ctx.plugin(specialized,{projectRoot:root,stateDir:config.stateDir});
 }
 if(config.autoProjects)await ctx.plugin(generic,{stateDir:config.genericStateDir,excludedRoots});
}
