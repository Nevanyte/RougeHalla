using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>P-UNITY-DECLUTTER-1 review note 1: the Tab map's MAP KEY lists "Camp buff" and "Elite camp" and the IN VIEW list starts below the last key row.</summary>
    public sealed class DeclutterLegendEditModeTests
    {
        GameObject _uiRoot, _clientObject, _controllerObject;

        [TearDown]
        public void TearDown()
        {
            Object.DestroyImmediate(_controllerObject); Object.DestroyImmediate(_clientObject); Object.DestroyImmediate(_uiRoot);
        }

        sealed class NullTransport : ITransport
        {
            public event System.Action Opened;
            public event System.Action<byte[]> Received;
            public event System.Action<string> Closed;
            public void Connect(string url) { }
            public void Send(byte[] frame) { }
            public void Close() { }
            public void Poll() { }
        }

        [Test]
        public void TheKeyListsCampBuffAndEliteCampAndInViewStartsBelowTheLastKeyRow()
        {
            var session = new Session(new NullTransport(), new SessionOptions { Url = "ws://localhost/ws", Profile = "fixture", Now = () => 1000 });
            _uiRoot = new GameObject("legend canvas", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster));
            _clientObject = new GameObject("legend client");
            var client = _clientObject.AddComponent<MatchClient>(); client.enabled = false; client.Url = "ws://localhost/legend"; client.Profile = "fixture";
            _controllerObject = new GameObject("legend controller");
            var controller = _controllerObject.AddComponent<TacticalMapController>();
            controller.Initialize(client, _uiRoot.transform);
            controller.Bind(session);
            controller.SetOpen(true);
            controller.Tick();
            Canvas.ForceUpdateCanvases();

            var page = _uiRoot.transform.Find("TacticalMap/TacticalInformation/ContactsPage");
            var key = page.Find("Key");
            Assert.IsNotNull(key);
            var labels = new System.Collections.Generic.List<string>();
            RectTransform last = null;
            foreach (Transform row in key) { labels.Add(row.Find("Text").GetComponent<TMP_Text>().text); last = (RectTransform)row; }
            CollectionAssert.Contains(labels, "Players");
            CollectionAssert.Contains(labels, "Camp buff");
            CollectionAssert.Contains(labels, "Elite camp");
            if (!key.gameObject.activeInHierarchy) Assert.Pass("compact layout hides the key");
            var corners = new Vector3[4]; var head = new Vector3[4];
            last.GetWorldCorners(corners); ((RectTransform)page.Find("InViewHeading")).GetWorldCorners(head);
            Assert.LessOrEqual(head[1].y, corners[0].y + .01f, "the IN VIEW heading starts at or below the bottom of the last key row");
        }
    }
}
