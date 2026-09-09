import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentName} from '../shared/documents.js';
test('document names cannot escape the document directory or create shell scripts',()=>{
 assert.equal(documentName('ag-ui-research.txt'),'ag-ui-research.txt');
 assert.equal(documentName('infographic.html'),'infographic.html');
 for(const name of ['../secret.txt','/tmp/test.txt','a/b.txt','a\\b.txt','.env','run.sh','x.txt\r\nX:1','a'.repeat(100)+'.txt'])assert.throws(()=>documentName(name));
});
