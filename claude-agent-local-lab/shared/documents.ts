export function documentName(value:string){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}\.(txt|md|csv|json|html|pdf)$/.test(value))throw new Error('Use a simple filename ending in .txt, .md, .csv, .json, .html or .pdf, without folders.');
  return value;
}
