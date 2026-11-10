using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    public sealed class MatchLaunchConfigTests
    {
        static AccountEndpoint Endpoint(string url = "https://game.example/api/") =>
            AccountEndpoint.FromPage("https://game.example/play", url);

        [Test]
        public void ExistingArenaTargetRemainsAvailableWhenTrainingIsNotConfigured()
        {
            var config = new MatchLaunchConfig(Endpoint(), "wss://game.example/ws", null);

            var arena = config.Target(MatchLaunchMode.Arena);
            var training = config.Target(MatchLaunchMode.Training);

            Assert.That(arena.Available, Is.True);
            Assert.That(arena.Url, Is.EqualTo("wss://game.example/ws"));
            Assert.That(training.Available, Is.False);
            Assert.That(training.Url, Is.Empty);
            Assert.That(training.UnavailableReason, Does.Contain("Training is unavailable"));
        }

        [TestCase(null)]
        [TestCase(false)]
        public void MissingOrFalseFactDoesNotConfirmTraining(bool? fact)
        {
            var target = new MatchLaunchConfig(Endpoint(), "wss://game.example/ws", "wss://game.example/training/ws")
                .Target(MatchLaunchMode.Training);

            Assert.That(target.MatchesServer(fact), Is.False);
        }

        [Test]
        public void ServerFactsConfirmOnlyTheMatchingMode()
        {
            var config = new MatchLaunchConfig(Endpoint(), "wss://game.example/ws", "wss://game.example/training/ws");
            var arena = config.Target(MatchLaunchMode.Arena);
            var training = config.Target(MatchLaunchMode.Training);

            Assert.That(arena.MatchesServer(false), Is.True);
            Assert.That(arena.MatchesServer(true), Is.False);
            Assert.That(training.MatchesServer(true), Is.True);
            Assert.That(training.MatchesServer(false), Is.False);
        }

        [Test]
        public void InvalidTrainingTargetDoesNotDisableValidArenaOrFallbackTrainingToArena()
        {
            var config = new MatchLaunchConfig(Endpoint(), "wss://game.example/ws", "wss://elsewhere.example/training/ws");

            Assert.That(config.Target(MatchLaunchMode.Arena).Available, Is.True);
            var training = config.Target(MatchLaunchMode.Training);
            Assert.That(training.Available, Is.False);
            Assert.That(training.Url, Is.Empty);
            Assert.That(training.UnavailableReason, Does.Contain("Training is unavailable"));
            Assert.That(training.UnavailableReason, Does.Not.Contain("elsewhere.example"));
        }

        [TestCase("")]
        [TestCase("ws://game.example/ws")]
        [TestCase("wss://user:secret@game.example/ws")]
        [TestCase("wss://game.example/ws?token=secret")]
        [TestCase("wss://game.example/ws#fragment")]
        [TestCase("wss://game.example/not-ws")]
        [TestCase("wss://other.example/ws")]
        [TestCase("wss://game.example:444/ws")]
        public void InvalidArenaTargetsFailClosedWithoutEchoingUrl(string url)
        {
            var target = new MatchLaunchConfig(Endpoint(), url, "wss://game.example/training/ws").Target(MatchLaunchMode.Arena);

            Assert.That(target.Available, Is.False);
            Assert.That(target.Url, Is.Empty);
            Assert.That(target.UnavailableReason, Does.Not.Contain("secret"));
            Assert.That(target.UnavailableReason, Does.Not.Contain("game.example"));
        }

        [Test]
        public void InvalidTrainingTargetsAreIndependentAndFailClosed()
        {
            var cases = new[]
            {
                "", "ws://game.example/training/ws", "wss://user:secret@game.example/training/ws",
                "wss://game.example/training/ws?key=secret", "wss://game.example/training/ws#fragment",
                "wss://game.example/training", "wss://other.example/training/ws", "wss://game.example:444/training/ws",
            };

            foreach (var url in cases)
            {
                var config = new MatchLaunchConfig(Endpoint(), "wss://game.example/ws", url);
                Assert.That(config.Target(MatchLaunchMode.Arena).Available, Is.True, url);
                var training = config.Target(MatchLaunchMode.Training);
                Assert.That(training.Available, Is.False, url);
                Assert.That(training.Url, Is.Empty, url);
                Assert.That(training.UnavailableReason, Does.Not.Contain("secret"), url);
                Assert.That(training.UnavailableReason, Does.Not.Contain("other.example"), url);
            }
        }

        [Test]
        public void UnknownModeIsUnavailableAndNeverFallsBack()
        {
            var target = new MatchLaunchConfig(Endpoint(), "wss://game.example/ws", "wss://game.example/training/ws")
                .Target((MatchLaunchMode)77);

            Assert.That(target.Mode, Is.EqualTo((MatchLaunchMode)77));
            Assert.That(target.Available, Is.False);
            Assert.That(target.Url, Is.Empty);
            Assert.That(target.MatchesServer(false), Is.False);
            Assert.That(target.MatchesServer(true), Is.False);
        }

        [Test]
        public void MissingEndpointMakesBothTargetsUnavailable()
        {
            var config = new MatchLaunchConfig(null, "wss://game.example/ws", "wss://game.example/training/ws");

            Assert.That(config.Target(MatchLaunchMode.Arena).Available, Is.False);
            Assert.That(config.Target(MatchLaunchMode.Training).Available, Is.False);
        }

        [Test]
        public void UnavailableTargetsReportWhichPartOfThePolicyRefusedThem()
        {
            var config = new MatchLaunchConfig(Endpoint(), "wss://elsewhere.example/ws", null);
            Assert.That(config.Target(MatchLaunchMode.Arena).Kind, Is.EqualTo(LaunchUnavailableKind.OtherSite));
            Assert.That(config.Target(MatchLaunchMode.Training).Kind, Is.EqualTo(LaunchUnavailableKind.NotConfigured));
            Assert.That(new MatchLaunchConfig(Endpoint(), "not a url", null).Target(MatchLaunchMode.Arena).Kind, Is.EqualTo(LaunchUnavailableKind.BadAddress));
            Assert.That(new MatchLaunchConfig(null, "wss://game.example/ws", null).Target(MatchLaunchMode.Arena).Kind, Is.EqualTo(LaunchUnavailableKind.NoAccountService));
            var ok = new MatchLaunchConfig(Endpoint(), "wss://game.example/ws", null).Target(MatchLaunchMode.Arena);
            Assert.That(ok.Available, Is.True);
            Assert.That(ok.Kind, Is.EqualTo(LaunchUnavailableKind.None));
            // The policy verdict itself is unchanged: an unavailable target still carries no URL and the original reason text.
            Assert.That(config.Target(MatchLaunchMode.Arena).Url, Is.Empty);
            Assert.That(config.Target(MatchLaunchMode.Arena).UnavailableReason, Does.Contain("Arena is unavailable"));
        }
    }
}
