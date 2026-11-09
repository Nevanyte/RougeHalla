using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using Mono.Cecil;
static object Unwrap(object value)
{
    while (value is CustomAttributeArgument a) value = a.Value;
    return value;
}
static object JsonValue(object value)
{
    value = Unwrap(value);
    if (value == null) return null;
    if (value is CustomAttributeArgument[] array) return array.Select(x => JsonValue(x)).ToArray();
    if (value is System.Collections.IEnumerable seq && value is not string) {
        var items = new List<object>(); foreach (var item in seq) items.Add(JsonValue(item)); return items;
    }
    return value switch {
        bool b => b,
        byte n => (int)n,
        sbyte n => (int)n,
        short n => (int)n,
        ushort n => (int)n,
        int n => n,
        uint n => n.ToString(CultureInfo.InvariantCulture),
        long n => n.ToString(CultureInfo.InvariantCulture),
        ulong n => n.ToString(CultureInfo.InvariantCulture),
        _ => value.ToString()
    };
}
static string Display(object value)
{
    value = Unwrap(value);
    if (value is bool b) return b ? "True" : "False";
    return Convert.ToString(value, CultureInfo.InvariantCulture) ?? "null";
}
var assemblyPath = args[0];
using var assembly = AssemblyDefinition.ReadAssembly(assemblyPath);
var results = new List<object>();
foreach (var type in assembly.MainModule.Types.Where(t => t.Name == "MatchSettlementEditModeTests"))
foreach (var method in type.Methods)
{
    var attrs = method.CustomAttributes.Where(a => a.AttributeType.FullName is "NUnit.Framework.TestAttribute" or "NUnit.Framework.TestCaseAttribute").ToArray();
    var testCases = attrs.Where(a => a.AttributeType.FullName == "NUnit.Framework.TestCaseAttribute").ToArray();
    var isTest = attrs.Any(a => a.AttributeType.FullName == "NUnit.Framework.TestAttribute");
    if (!isTest && testCases.Length == 0) continue;
    var parameters = method.Parameters.Select(p => new { name = p.Name, declaredType = p.ParameterType.FullName }).ToArray();
    var cases = new List<(object args, string[] displayArgs)>();
    if (testCases.Length == 0) cases.Add((Array.Empty<object>(), Array.Empty<string>()));
    foreach (var attribute in testCases)
    {
        var constructorArgs = attribute.ConstructorArguments;
        var vals = constructorArgs.Select(a => JsonValue(a.Value)).ToArray();
        // TestCaseAttribute(object[]) arrives as one array constructor argument in metadata.
        if (constructorArgs.Count == 1 && constructorArgs[0].Value is CustomAttributeArgument[] packed)
            vals = packed.Select(a => JsonValue(a)).ToArray();
        var attrsOut = new List<object>();
        var displayValues = new List<string>();
        for (int i = 0; i < vals.Length; i++)
        {
            object raw = i < constructorArgs.Count ? constructorArgs[i].Value : null;
            if (constructorArgs.Count == 1 && constructorArgs[0].Value is CustomAttributeArgument[] packed2 && i < packed2.Length) raw = packed2[i];
            raw = Unwrap(raw);
            string valueType = raw?.GetType().FullName ?? "null";
            var displayValue = Display(raw);
            attrsOut.Add(new { declaredType = i < parameters.Length ? parameters[i].declaredType : null, attributeValueType = valueType, value = vals[i], displayValue });
            displayValues.Add(displayValue);
        }
        cases.Add((attrsOut.ToArray(), displayValues.ToArray()));
    }
    foreach (var @case in cases)
    {
        var display = @case.displayArgs;
        string selector = method.Name + (display.Length > 0 ? "(" + string.Join(",", display) + ")" : "");
        results.Add(new {
            fixture = type.FullName,
            method = method.Name,
            methodReturnType = method.ReturnType.FullName,
            parameters,
            simpleToolLeafSelector = selector,
            fullName = type.FullName + "." + selector,
            arguments = @case.args
        });
    }
}
Console.Write(JsonSerializer.Serialize(new { assemblyPath, assemblySha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(assemblyPath))).ToLowerInvariant(), cases = results }, new JsonSerializerOptions { WriteIndented = true }));
