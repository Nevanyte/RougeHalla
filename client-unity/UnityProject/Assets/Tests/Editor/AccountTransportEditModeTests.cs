using System;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;

public sealed class AccountTransportEditModeTests
{
    const string Summary = "{\"profile\":{\"name\":\"Alice\",\"gv\":10,\"gvLifetime\":20,\"stats\":{\"runs\":2,\"wins\":1,\"draws\":0,\"deaths\":1,\"kills\":1},\"gvByMonth\":{\"2026-11\":20},\"cosmetics\":{\"owned\":[],\"equipped\":{}},\"achievements\":{},\"progress\":{}},\"token\":\"local-test-key\",\"created\":false}";

    [Test]
    public void ActualUnityJsonDecoderReadsTheRustEnvelopeAndSummaryWithoutClaimingFullProfile()
    {
        var reply = UnityAccountJson.Decode(Summary);
        Assert.That(reply, Is.Not.Null);
        Assert.That(reply.profile.name, Is.EqualTo("Alice"));
        Assert.That(reply.profile.gv, Is.EqualTo(10));
        Assert.That(reply.profile.gvLifetime, Is.EqualTo(20));
        Assert.That(reply.profile.stats.runs, Is.EqualTo(2));
        Assert.That(reply.profile.stats.kills, Is.EqualTo(1));
        Assert.That(reply.created, Is.False);
        Assert.That(reply.token == "local-test-key", Is.True);
    }

    [Test]
    public void OmittedCountersRetainInvalidSentinelsInsteadOfBecomingPlausibleZeros()
    {
        var reply = UnityAccountJson.Decode("{\"profile\":{\"name\":\"Alice\",\"stats\":{\"runs\":0}},\"token\":\"test\"}");
        Assert.That(reply.profile.gv, Is.EqualTo(-1));
        Assert.That(reply.profile.gvLifetime, Is.EqualTo(-1));
        Assert.That(reply.profile.stats.wins, Is.EqualTo(-1));
    }

    [Test]
    public void InvalidJsonIsNotAnOwnedReply()
    {
        Assert.That(UnityAccountJson.Decode("not-json"), Is.Null);
        Assert.That(UnityAccountJson.Decode(null), Is.Null);
    }

    [Test]
    public void PlayerPrefsCredentialKeysSeparateNormalizedApiPrefixesAndCaseFoldedAsciiNames()
    {
        var store = new PlayerPrefsAccountCredentials();
        string scope = "https://local-test.invalid/" + Guid.NewGuid().ToString("N") + "/api/";
        string other = scope.Replace("/api/", "/other/api/");
        try
        {
            Assert.That(store.WriteConfirmed(scope, "Alice", "local-test-key"), Is.True);
            Assert.That(store.Read(scope, "aLICE") == "local-test-key", Is.True);
            Assert.That(store.Read(other, "alice"), Is.Empty);
        }
        finally
        {
            // Remove only this test's random namespace, never a player's keys.
            UnityEngine.PlayerPrefs.DeleteKey("rh.account.owner.v1." + Uri.EscapeDataString(scope) + ".alice");
            UnityEngine.PlayerPrefs.Save();
        }
    }
}
