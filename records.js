import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export function atomicWrite(file,text){
 const temp=path.join(path.dirname(file),'.otato-'+randomUUID());
 try{fs.writeFileSync(temp,text,{mode:fs.existsSync(file)?fs.statSync(file).mode&0o777:0o600,flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
