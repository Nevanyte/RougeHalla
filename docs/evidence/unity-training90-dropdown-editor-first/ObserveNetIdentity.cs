using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Reflection;
using System.Reflection.Emit;
using System.Security.Cryptography;
using Roguehalla.Net;
var types=new[]{typeof(Session),typeof(SeatResume)};
var assembly=typeof(Session).Assembly;
if(AppDomain.CurrentDomain.GetAssemblies().Count(a=>a.GetName().Name=="RoguehallaNet")!=1)throw new InvalidOperationException("Expected one current Net assembly");
var opcodes=typeof(OpCodes).GetFields(BindingFlags.Public|BindingFlags.Static).Where(f=>f.FieldType==typeof(OpCode)).Select(f=>(OpCode)f.GetValue(null)).ToDictionary(o=>unchecked((ushort)o.Value));
var result=new List<object>();
foreach(var type in types){
var flags=BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance|BindingFlags.Static|BindingFlags.DeclaredOnly;
var methods=type.GetMethods(flags).Cast<MethodBase>().Concat(type.GetConstructors(flags)).ToArray();
var records=new List<object>();
foreach(var method in methods){
if(!(type==typeof(SeatResume)||new[]{".ctor","OnReceived","OnWelcome","Detach","OnOpened"}.Contains(method.Name)))continue;
var body=method.GetMethodBody();if(body==null)throw new InvalidOperationException("Missing own method body");var bytes=body.GetILAsByteArray();var instructions=new List<object>();var calls=new List<string>();int at=0;
while(at<bytes.Length){int offset=at;ushort code=bytes[at++];if(code==0xfe)code=(ushort)(0xfe00|bytes[at++]);var op=opcodes[code];int size;string target=null;
switch(op.OperandType){case OperandType.InlineNone:size=0;break;case OperandType.ShortInlineBrTarget:case OperandType.ShortInlineI:case OperandType.ShortInlineVar:size=1;break;case OperandType.InlineVar:size=2;break;case OperandType.InlineI8:case OperandType.InlineR:size=8;break;case OperandType.InlineSwitch:size=checked(4+4*BitConverter.ToInt32(bytes,at));break;default:size=4;break;}
if(at+size>bytes.Length)throw new InvalidOperationException("Invalid IL operand");
if(op.OperandType==OperandType.InlineMethod){var m=method.Module.ResolveMethod(BitConverter.ToInt32(bytes,at));target=m.DeclaringType.FullName+"."+m.Name;calls.Add(target);}
if(op.OperandType==OperandType.InlineField){var f=method.Module.ResolveField(BitConverter.ToInt32(bytes,at));target=f.DeclaringType.FullName+"."+f.Name;}
instructions.Add(new{offset,opcode=op.Name,operandHex=size==0?String.Empty:BitConverter.ToString(bytes,at,size),resolvedMember=target});at+=size;
}
using(var sha=SHA256.Create())records.Add(new{name=method.Name,returnType=method is MethodInfo?((MethodInfo)method).ReturnType.FullName:"<ctor>",parameters=method.GetParameters().Select(p=>new{name=p.Name,type=p.ParameterType.FullName}).ToArray(),moduleMvid=method.Module.ModuleVersionId.ToString(),ilSha256=BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant(),calls,instructions});
}
result.Add(new{type=type.FullName,fields=type.GetFields(flags).Select(f=>new{name=f.Name,type=f.FieldType.FullName}).ToArray(),methods=records});
}
string hash;using(var sha=SHA256.Create())hash=BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(assembly.Location))).Replace("-","").ToLowerInvariant();
return new{scope="Own Net CLR metadata and method IL only. No Session/SeatResume instances created or values read; no bearer capability logged, no test invocation.",assembly=assembly.FullName,moduleMvid=assembly.ManifestModule.ModuleVersionId.ToString(),assemblyLocation=assembly.Location,assemblyFileSha256=hash,types=result};
