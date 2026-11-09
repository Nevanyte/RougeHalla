using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;

namespace Roguehalla.Net.Tests
{
    public sealed class AccountSettlementJsonTests
    {
        const string Match = "01234567-89ab-cdef-0123-456789abcdef";

        [Test]
        public void UnknownReceiptIsDistinctAndHasNoSettlementPayload()
        {
            Assert.IsTrue(AccountFullJson.TrySettlement("{\"v\":1,\"matchId\":\"" + Match + "\",\"status\":\"unknown\"}", Match, out var receipt));
            Assert.AreEqual(AccountSettlementStatus.Unknown, receipt.Status);
            Assert.AreEqual(Match, receipt.MatchId);
            Assert.IsNull(receipt.Outcome);
            Assert.IsNull(receipt.GvCredited);
        }

        [TestCase("won", 0)]
        [TestCase("draw", 47)]
        [TestCase("died", 9007199254740991L)]
        [TestCase("mia", 3)]
        public void CommittedReceiptPreservesOutcomeAndSafeCredit(string outcome, long credit)
        {
            string json = "{\"v\":1,\"matchId\":\"" + Match + "\",\"status\":\"committed\",\"settlement\":{\"outcome\":\"" + outcome + "\",\"gvCredited\":" + credit + "}}";
            Assert.IsTrue(AccountFullJson.TrySettlement(json, Match, out var receipt));
            Assert.AreEqual(AccountSettlementStatus.Committed, receipt.Status);
            Assert.AreEqual(credit, receipt.GvCredited);
            Assert.AreEqual(outcome == "won" ? AccountSettlementOutcome.Won : outcome == "draw" ? AccountSettlementOutcome.Draw :
                outcome == "died" ? AccountSettlementOutcome.Died : AccountSettlementOutcome.Mia, receipt.Outcome);
        }

        [Test]
        public void ExplicitNullOutcomeIsAValidCommittedVoid()
        {
            Assert.IsTrue(AccountFullJson.TrySettlement("{\"v\":1,\"matchId\":\"" + Match + "\",\"status\":\"committed\",\"settlement\":{\"outcome\":null,\"gvCredited\":0}}", Match, out var receipt));
            Assert.AreEqual(AccountSettlementStatus.Committed, receipt.Status);
            Assert.IsNull(receipt.Outcome);
            Assert.AreEqual(0L, receipt.GvCredited);
        }

        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"unknown\",\"settlement\":{}}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"committed\"}")]
        [TestCase("{\"v\":2,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"unknown\"}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"future\"}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"unknown\",\"future\":0}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"unknown\",\"status\":\"unknown\"}")]
        [TestCase("{\"v\":1,\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"unknown\"}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"committed\",\"settlement\":{\"outcome\":\"won\"}}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"committed\",\"settlement\":{\"gvCredited\":0}}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"committed\",\"settlement\":{\"outcome\":null,\"gvCredited\":0.0}}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"committed\",\"settlement\":{\"outcome\":null,\"gvCredited\":\"0\"}}")]
        [TestCase("{\"v\":\"1\",\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"unknown\"}")]
        [TestCase("{\"v\":1.0,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"unknown\"}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"committed\",\"settlement\":null}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"committed\",\"settlement\":{\"outcome\":0,\"gvCredited\":0}}")]
        [TestCase("{\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"unknown\"}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"committed\",\"settlement\":{\"outcome\":\"won\",\"outcome\":\"draw\",\"gvCredited\":0}}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"committed\",\"settlement\":{\"outcome\":null,\"gvCredited\":0,\"future\":1}}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"committed\",\"settlement\":{\"outcome\":\"won\",\"gvCredited\":-1}}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"committed\",\"settlement\":{\"outcome\":\"won\",\"gvCredited\":9007199254740992}}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"status\":\"committed\",\"settlement\":{\"outcome\":\"Won\",\"gvCredited\":0}}")]
        [TestCase("{\"v\":1,\"matchId\":\"01234567-89ab-cdef-0123-456789ABCDEF\",\"status\":\"unknown\"}")]
        public void InvalidOrNoncanonicalReceiptsFailClosed(string json)
        {
            Assert.IsFalse(AccountFullJson.TrySettlement(json, Match, out var receipt));
            Assert.IsNull(receipt);
        }

        [Test]
        public void ResponseMustEchoTheRequestedMatchIdExactly()
        {
            const string other = "11234567-89ab-cdef-0123-456789abcdef";
            Assert.IsFalse(AccountFullJson.TrySettlement("{\"v\":1,\"matchId\":\"" + other + "\",\"status\":\"unknown\"}", Match, out _));
            Assert.IsFalse(AccountFullJson.TrySettlement("{\"v\":1,\"matchId\":\"" + Match + "\",\"status\":\"unknown\"}{}", Match, out _));
        }

        [Test]
        public void ReceiptShapeIsNotAcceptedAsLeaderboardAndExistingLeaderboardShapeIsNotReceipt()
        {
            string receipt = "{\"v\":1,\"matchId\":\"" + Match + "\",\"status\":\"unknown\"}";
            string leaderboard = "{\"month\":\"2026-11\",\"entries\":[],\"months\":[]}";
            Assert.IsFalse(AccountFullJson.TryLeaderboard(receipt, out _));
            Assert.IsFalse(AccountFullJson.TrySettlement(leaderboard, Match, out _));
            Assert.IsTrue(AccountFullJson.TryLeaderboard(leaderboard, out var board));
            Assert.AreEqual("2026-11", board.Month);
            Assert.IsTrue(AccountFullJson.TryApiRead(AccountApiReadKind.Settlement, receipt, Match, out var noBoard, out var settlement));
            Assert.IsNull(noBoard); Assert.AreEqual(AccountSettlementStatus.Unknown, settlement.Status);
            Assert.IsTrue(AccountFullJson.TryApiRead(AccountApiReadKind.Leaderboard, leaderboard, Match, out var typedBoard, out var noSettlement));
            Assert.AreEqual("2026-11", typedBoard.Month); Assert.IsNull(noSettlement);
            Assert.IsFalse(AccountFullJson.TryApiRead((AccountApiReadKind)99, receipt, Match, out _, out _));
        }
    }
}
