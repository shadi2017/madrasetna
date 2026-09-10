import assert from 'node:assert/strict';
import {parseQr,total,summary,validStudent,defaultSettings,categories} from '../app/core/model.ts';
assert.equal(categories.length,10);
assert.equal(total(undefined),0);
const student={id:'s'},day={id:'d',deleted_at:null},evaluation={student_id:'s',day_id:'d',present:true,scores:{quiz:8,bible:9},deleted_at:null};
assert.equal(total(evaluation),27);
const data={students:[student],days:[day],evaluations:[evaluation],settings:defaultSettings};
assert.deepEqual(summary(student,data),{points:27,max:110,percent:25,present:1,days:1});
assert.equal(summary(student,{...data,days:[{...day,deleted_at:'x'}]}).points,0);
assert.equal(total({...evaluation,deleted_at:'x'}),0);
assert.equal(parseQr('madrasetna:v1:20000000-0000-4000-8000-000000000002'),'20000000-0000-4000-8000-000000000002');
assert.throws(()=>parseQr('https://example.com/student/1'));
assert.throws(()=>parseQr('madrasetna:v1:1'));
assert.equal(validStudent('مينا جورج','01012345678','mina_1'),true);
assert.equal(validStudent('مينا جورج','10123','mina_1'),false);
assert.equal(validStudent('مينا جورج','01012345678','ADMIN@abc'),false);
console.log('PASS: score totals, deleted-record exclusion, QR format and student validation.');

