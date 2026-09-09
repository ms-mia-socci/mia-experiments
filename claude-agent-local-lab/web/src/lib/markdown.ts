import MarkdownIt from 'markdown-it';
// Escape embedded HTML; markdown-it also rejects unsafe URL schemes.
const markdown=new MarkdownIt({html:false,linkify:false,breaks:true});
export const renderMarkdown=(text:string)=>markdown.render(text);
