using System;
using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    public sealed class AccountSettlementTests
    {
        [Test]
        public void NetworkWelcomeBytesFormatAsCanonicalUuidWithoutGuidMixedEndian()
        {
            var bytes = new byte[16];
            for (int i = 0; i < bytes.Length; i++) bytes[i] = (byte)i;
            Assert.IsTrue(AccountSettlementId.TryFormatNetworkBytes(bytes, out var id));
            Assert.AreEqual("00010203-0405-0607-0809-0a0b0c0d0e0f", id);
            Assert.IsTrue(AccountSettlementId.IsCanonicalLower(id));
        }

        [Test]
        public void FormatterPreservesAllZeroAndAllOneBitsWithoutUuidVariantRules()
        {
            Assert.IsTrue(AccountSettlementId.TryFormatNetworkBytes(new byte[16], out var zeroes));
            Assert.AreEqual("00000000-0000-0000-0000-000000000000", zeroes);
            var ones = new byte[16];
            for (int i = 0; i < ones.Length; i++) ones[i] = 0xff;
            Assert.IsTrue(AccountSettlementId.TryFormatNetworkBytes(ones, out var ffs));
            Assert.AreEqual("ffffffff-ffff-ffff-ffff-ffffffffffff", ffs);
        }

        [Test]
        public void FormatterRejectsAnythingOtherThanSixteenRawBytes()
        {
            byte[][] invalid = { null, Array.Empty<byte>(), new byte[15], new byte[17] };
            foreach (var bytes in invalid)
            {
                Assert.IsFalse(AccountSettlementId.TryFormatNetworkBytes(bytes, out var id));
                Assert.IsNull(id);
            }
        }

        [TestCase("00010203-0405-0607-0809-0A0B0C0D0E0F")]
        [TestCase("000102030405060708090a0b0c0d0e0f")]
        [TestCase("00010203-04050607-0809-0a0b0c0d0e0f")]
        [TestCase("00010203-0405-0607-0809-0a0b0c0d0efg")]
        public void CanonicalValidatorRequiresLowercaseHyphenatedUuid(string value)
        {
            Assert.IsFalse(AccountSettlementId.IsCanonicalLower(value));
        }

        [Test]
        public void UnknownAndCommittedVoidAreDistinctAndCreditIsTyped()
        {
            var unknown = new AccountSettlement("00010203-0405-0607-0809-0a0b0c0d0e0f", AccountSettlementStatus.Unknown);
            Assert.AreEqual(1, unknown.Version);
            Assert.IsNull(unknown.Outcome);
            Assert.IsNull(unknown.GvCredited);

            var voided = new AccountSettlement(1, unknown.MatchId, AccountSettlementStatus.Committed, null, 0);
            Assert.AreEqual(AccountSettlementStatus.Committed, voided.Status);
            Assert.IsNull(voided.Outcome);
            Assert.AreEqual(0L, voided.GvCredited);

            var won = new AccountSettlement(unknown.MatchId, AccountSettlementStatus.Committed, AccountSettlementOutcome.Won, AccountSettlement.MaxSafeInteger);
            Assert.AreEqual(AccountSettlementOutcome.Won, won.Outcome);
            Assert.AreEqual(AccountSettlement.MaxSafeInteger, won.GvCredited);
        }

        [Test]
        public void InvalidReceiptCombinationsFailClosed()
        {
            const string id = "00010203-0405-0607-0809-0a0b0c0d0e0f";
            Assert.Throws<ArgumentException>(() => new AccountSettlement(id, AccountSettlementStatus.Unknown, gvCredited: 0));
            Assert.Throws<ArgumentException>(() => new AccountSettlement(id, AccountSettlementStatus.Unknown, AccountSettlementOutcome.Won));
            Assert.Throws<ArgumentOutOfRangeException>(() => new AccountSettlement(id, AccountSettlementStatus.Committed));
            Assert.Throws<ArgumentOutOfRangeException>(() => new AccountSettlement(id, AccountSettlementStatus.Committed, gvCredited: -1));
            Assert.Throws<ArgumentOutOfRangeException>(() => new AccountSettlement(id, AccountSettlementStatus.Committed, gvCredited: AccountSettlement.MaxSafeInteger + 1));
            Assert.Throws<ArgumentOutOfRangeException>(() => new AccountSettlement(2, id, AccountSettlementStatus.Unknown));
            Assert.Throws<ArgumentException>(() => new AccountSettlement(id.ToUpperInvariant(), AccountSettlementStatus.Unknown));
        }
    }
}
