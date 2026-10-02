/// <reference types="node" />
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import type {TextProps, PressableProps} from 'react-native';
import ts from 'typescript';
import {beforeEach,expect,it,vi} from 'vitest';

const captured=vi.hoisted(()=>({texts:[] as TextProps[],buttons:[] as PressableProps[]}));
vi.mock('react-native',async()=>{
  const web=await import('react-native-web');
  return {...web,Text:(props:TextProps)=>{captured.texts.push(props);return <span>{props.children}</span>;},Pressable:(props:PressableProps)=>{captured.buttons.push(props);return <div>{typeof props.children==='function'?props.children({pressed:false,hovered:false}):props.children}</div>;}};
});
vi.mock('./design-assets',()=>({NavigationIcon:()=>null,Portrait:()=>null,DesignIcon:()=>null}));
import {BottomNavigation} from './app-navigation';
import {Action,ConversationPicker,ui} from './learner-panels';
import {initialFirstDayState} from './state';
import {StyleSheet} from 'react-native';

// RN web drops native sizing props. Capture the props delivered by the actual
// components and inspect JSX contracts; actual native layout remains a device gate.
function source(file:string){return ts.createSourceFile(file,readFileSync(new URL(file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);}
function openings(file:string,tag:string){const result:(ts.JsxOpeningElement|ts.JsxSelfClosingElement)[]=[];const visit=(node:ts.Node)=>{if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText()===tag)result.push(node);ts.forEachChild(node,visit);};visit(source(file));return result;}
function attr(node:ts.JsxOpeningElement|ts.JsxSelfClosingElement,name:string){return node.attributes.properties.find((p):p is ts.JsxAttribute=>ts.isJsxAttribute(p)&&p.name.getText()===name)?.initializer?.getText();}
beforeEach(()=>{captured.texts.length=0;captured.buttons.length=0;});

it('bounds native tab typography while retaining every full tab label and selection state',()=>{
  renderToStaticMarkup(<BottomNavigation value='questions' onChange={()=>{}}/>);
  expect(captured.texts.map(p=>p.children)).toEqual(['Training','Questions','About','Practice']);
  for(const text of captured.texts){expect(text.maxFontSizeMultiplier).toBe(1.2);expect(text.allowFontScaling).not.toBe(false);expect(text.adjustsFontSizeToFit).toBe(true);expect(text.numberOfLines).toBe(1);expect(text.minimumFontScale).toBeGreaterThanOrEqual(0.85);}
  for(const [index,button] of captured.buttons.entries()){expect(button.accessibilityLabel).toBe(captured.texts[index]?.children);expect(button.accessibilityRole).toBe('tab');expect(button.accessibilityState?.selected).toBe(index===1);const style=StyleSheet.flatten(typeof button.style==='function'?button.style({pressed:false,hovered:false}):button.style);expect(style?.minHeight).toBeGreaterThanOrEqual(44);expect(style?.minWidth).toBeGreaterThanOrEqual(44);}
});

it('bounds the three fixed learner header texts and leaves content text scalable',()=>{
  const texts=openings('./first-day-screen.tsx','Text');
  for(const name of ['welcome','wordmark','pageTitle']){const text=texts.find(t=>attr(t,'style')===`{styles.${name}}`);expect(text,name).toBeDefined();expect(attr(text!,'maxFontSizeMultiplier')).toBe('{1.3}');}
  for(const text of texts.filter(t=>!['welcome','wordmark','pageTitle','stepNumber','stepText'].some(name=>attr(t,'style')?.includes(`styles.${name}`)))){expect(attr(text,'maxFontSizeMultiplier')).toBeUndefined();expect(attr(text,'allowFontScaling')).not.toBe('{false}');}
});

it.each(['fixture','bee'] as const)('bounds source-kind radio text and retains complete labels, %s checked state and 44pt targets',sourceKind=>{
  renderToStaticMarkup(<ConversationPicker state={{...initialFirstDayState.picker,sourceKind}} onLoad={()=>{}} onSelect={()=>{}} onContinue={()=>{}}/>);
  const labels=['Try an example','My Bee training'];
  const radios=captured.buttons.filter(p=>p.accessibilityRole==='radio');expect(radios).toHaveLength(2);
  for(const [index,radio] of radios.entries()){expect(radio.accessibilityLabel).toBe(labels[index]);expect(radio.accessibilityState?.checked).toBe(index===(sourceKind==='fixture'?0:1));const style=StyleSheet.flatten(typeof radio.style==='function'?radio.style({pressed:false,hovered:false}):radio.style);expect(style?.minHeight).toBeGreaterThanOrEqual(44);}
  for(const label of labels){const text=captured.texts.find(p=>p.children===label)!;expect(text.maxFontSizeMultiplier).toBe(1.3);expect(text.numberOfLines).toBe(1);expect(text.adjustsFontSizeToFit).toBe(true);expect(text.minimumFontScale).toBeGreaterThanOrEqual(0.85);expect(text.allowFontScaling).not.toBe(false);}
});

it('keeps all four home progress numbers and captions within their fixed columns',()=>{
  renderToStaticMarkup(<ConversationPicker state={initialFirstDayState.picker} onLoad={()=>{}} onSelect={()=>{}} onContinue={()=>{}}/>);
  for(const value of [1,2,3,4]){const text=captured.texts.find(p=>p.children===value)!;expect(text.maxFontSizeMultiplier).toBe(1.3);expect(text.numberOfLines).toBe(1);}
  for(const label of ['Choose','Review','Confirm','Practise']){const text=captured.texts.find(p=>p.children===label)!;expect(text.maxFontSizeMultiplier).toBe(1.2);expect(text.numberOfLines).toBe(1);expect(text.adjustsFontSizeToFit).toBe(true);expect(text.allowFontScaling).not.toBe(false);}
});

it('bounds the review step-circle number and adapts full review captions to four columns',()=>{
  const texts=openings('./first-day-screen.tsx','Text');
  const number=texts.find(t=>attr(t,'style')?.includes('styles.stepNumber'))!;expect(attr(number,'maxFontSizeMultiplier')).toBe('{1.3}');expect(attr(number,'numberOfLines')).toBe('{1}');
  const caption=texts.find(t=>attr(t,'style')?.includes('styles.stepText'))!;expect(attr(caption,'maxFontSizeMultiplier')).toBe('{1.2}');expect(attr(caption,'numberOfLines')).toBe('{1}');expect(attr(caption,'adjustsFontSizeToFit')).toBeUndefined();expect(caption.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText()==='adjustsFontSizeToFit')).toBe(true);
  const content=source('./first-day-screen.tsx').getText();expect(content).toContain('["Training", "Transcript", "Instructions", "Practice"]');expect(content).toContain('accessibilityLabel={"Step " + (step + 1) + " of 4"}');
});

it('keeps ordinary action text scalable and bounds only an explicitly fixed action',()=>{
  renderToStaticMarkup(<><Action label='Check my answer' onPress={()=>{}}/><Action label='Sign out and clear device drafts' maxFontSizeMultiplier={1.3} onPress={()=>{}}/></>);
  expect(captured.texts[0]?.maxFontSizeMultiplier).toBeUndefined();expect(captured.texts[1]?.maxFontSizeMultiplier).toBe(1.3);
  for(const text of captured.texts){expect(text.allowFontScaling).not.toBe(false);expect(text.numberOfLines).toBeUndefined();}
  expect(captured.texts[1]?.children).toBe('Sign out and clear device drafts');
  expect(ui.button.minHeight).toBeGreaterThanOrEqual(44);
});

it('reserves switch width and lets all three permission descriptions wrap with system text size',()=>{
  expect(ui.permissionRow?.flexWrap).toBe('nowrap');expect(ui.permissionText?.flex).toBe(1);expect(ui.permissionText?.minWidth).toBe(0);expect(ui.permissionSwitch?.flexShrink).toBe(0);
  for(const file of ['./learner-panels.tsx','./corrections-panel.tsx']){const switches=openings(file,'Switch');expect(switches.length).toBe(file.includes('corrections')?2:1);for(const control of switches){expect(attr(control,'style')).toBe('{ui.permissionSwitch}');expect(attr(control,'accessibilityLabel')).toBeDefined();}
    const rows=openings(file,'View').filter(v=>attr(v,'style')==='{ui.permissionRow}');expect(rows.length).toBe(switches.length);
    for(const text of openings(file,'Text')){expect(attr(text,'allowFontScaling')).not.toBe('{false}');if(attr(text,'style')?.includes('permissionText')){expect(attr(text,'maxFontSizeMultiplier')).toBeUndefined();expect(attr(text,'numberOfLines')).toBeUndefined();}}
  }
});

it('bounds the fixed sign-out action and applies the top safe area only once for a live learner',()=>{
  const action=openings('./live-session-screen.tsx','Action').find(a=>attr(a,'label')==="'Sign out and clear device drafts'");expect(action).toBeDefined();expect(attr(action!,'maxFontSizeMultiplier')).toBe('{1.3}');
  const top=openings('./live-session-screen.tsx','SafeAreaView').find(v=>attr(v,'edges')==="{['top']}");expect(attr(top!,'style')).toContain('flexShrink:0');
  const learner=openings('./first-day-screen.tsx','SafeAreaView')[0]!;expect(attr(learner,'edges')).toBe('{liveClient ? ["bottom"] : ["top", "bottom"]}');
});

it('keeps evidence, input and feedback free of a font cap or disabled system scaling',()=>{
  for(const file of ['./learner-panels.tsx','./practice-panel.tsx','./corrections-panel.tsx','./understanding-panel.tsx','./voice-rehearsal.tsx'])for(const tag of ['Text','TextInput'])for(const node of openings(file,tag)){expect(attr(node,'allowFontScaling'),`${file}:${node.pos}`).not.toBe('{false}');if(file.endsWith('learner-panels.tsx')&&tag==='Text'&&['buttonText','tabText','stepNumber','stepCaption'].some(name=>attr(node,'style')?.includes(`ui.${name}`)))continue;expect(attr(node,'maxFontSizeMultiplier'),`${file}:${node.pos}`).toBeUndefined();}
});
