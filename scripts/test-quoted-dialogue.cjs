const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync(require('path').resolve(__dirname, '../assets/js/markup.js'),'utf8'),c);
const input='{{C}} “Tell me about this photograph.”\n\n“It [[　]] [[オ]] [[　]] [[カ]] [[　]] special memories for me.”\n((1)) has　((2)) is　((3)) one\n\n{{D}} Next question';
const html=c.window.Markup.render(input).html;
assert.equal((html.match(/quoted-dialogue/g)||[]).length,1);assert.ok(html.indexOf('special memories')<html.indexOf('</div></div>'));assert.ok(html.indexOf('choice-inline')>html.indexOf('</div></div>'));assert.doesNotMatch(c.window.Markup.render('{{B}} Do [[　]] water\nNormal line').html,/quoted-dialogue/);
console.log('PASS: quoted exchange grouping; choices and ordinary headers stay outside');
