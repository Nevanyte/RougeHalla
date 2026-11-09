using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Emit;
using System.Collections.Generic;
using System.Security.Cryptography;
using TMPro;
var tests=AppDomain.CurrentDomain.GetAssemblies().Single(a=>a.GetName().Name=="Roguehalla.Client.EditModeTests");
var type=tests.GetType("Roguehalla.Client.Tests.EditModeTrainingDropdown",true);
var init=type.GetMethod("InitializeForEditMode",BindingFlags.Public|BindingFlags.Instance|BindingFlags.DeclaredOnly);
var fixture=tests.GetType("Roguehalla.Client.Tests.TrainingConsoleIntegrationEditModeTests",true);
var entry=fixture.GetMethod("DropdownEscapeRequestsPopupHideBeforeConsoleCloseAndTrainingLeave",BindingFlags.Public|BindingFlags.Instance|BindingFlags.DeclaredOnly);
var attr=entry.GetCustomAttributesData().Single(a=>a.AttributeType.FullName=="System.Runtime.CompilerServices.AsyncStateMachineAttribute");
var state=(Type)attr.ConstructorArguments[0].Value;
var move=state.GetMethod("MoveNext",BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance|BindingFlags.DeclaredOnly);
var start=typeof(TMP_Dropdown).GetMethod("Start",BindingFlags.NonPublic|BindingFlags.Instance|BindingFlags.DeclaredOnly);
var opcodes=typeof(OpCodes).GetFields(BindingFlags.Public|BindingFlags.Static).Where(f=>f.FieldType==typeof(OpCode)).Select(f=>(OpCode)f.GetValue(null)).ToDictionary(o=>unchecked((ushort)o.Value));
var records=new List<object>();
foreach(var method in new[]{init,move,start}) {
if(method==null||method.GetMethodBody()==null)throw new InvalidOperationException("Missing required loaded lifecycle method");
var bytes=method.GetMethodBody().GetILAsByteArray();var calls=new List<string>();var instructions=new List<object>();int at=0;
while(at<bytes.Length){int offset=at;ushort code=bytes[at++];if(code==0xfe)code=(ushort)(0xfe00|bytes[at++]);var op=opcodes[code];int size;string target=null;
switch(op.OperandType){case OperandType.InlineNone:size=0;break;case OperandType.ShortInlineBrTarget:case OperandType.ShortInlineI:case OperandType.ShortInlineVar:size=1;break;case OperandType.InlineVar:size=2;break;case OperandType.InlineI8:case OperandType.InlineR:size=8;break;case OperandType.InlineSwitch:size=checked(4+4*BitConverter.ToInt32(bytes,at));break;default:size=4;break;}
if(at+size>bytes.Length)throw new InvalidOperationException("Invalid IL operand");
if(op.OperandType==OperandType.InlineMethod){var m=method.Module.ResolveMethod(BitConverter.ToInt32(bytes,at));target=m.DeclaringType.FullName+"."+m.Name;calls.Add(target);}
instructions.Add(new{offset,opcode=op.Name,operandHex=size==0?String.Empty:BitConverter.ToString(bytes,at,size),resolvedMethod=target});at+=size;
}
string ih,dh;using(var sha=SHA256.Create()){ih=BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();dh=BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(method.DeclaringType.Assembly.Location))).Replace("-","").ToLowerInvariant();}
records.Add(new{type=method.DeclaringType.FullName,name=method.Name,returnType=method.ReturnType.FullName,moduleMvid=method.Module.ModuleVersionId.ToString(),assembly=method.DeclaringType.Assembly.FullName,dll=method.DeclaringType.Assembly.Location,dllSha256=dh,ilSha256=ih,calls,instructions});
}
return new{scope="Read-only CLR metadata and IL: own fixture initializer and async callsite plus explicit real TMP lifecycle target. No method invoked or component created.",records};
