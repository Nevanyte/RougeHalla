using System;
using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Threading;
using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    /// <summary>Controls for the measurement harness, independent of the decoder's allocation budget.</summary>
    public class AllocationMeasurementTests
    {
        static readonly MethodInfo MeasureMethod = typeof(GarbageTests).GetMethod("PerCall", BindingFlags.NonPublic | BindingFlags.Static);
        static object sink;

        static double Measure(Action<int> body)
        {
            try { return (double)MeasureMethod.Invoke(null, new object[] { body }); }
            catch (TargetInvocationException error) when (error.InnerException != null)
            {
                ExceptionDispatchInfo.Capture(error.InnerException).Throw();
                throw;
            }
        }

        [Test]
        public void WarmupAndMeasurementUseOneDedicatedWorkerWithoutCallerContext()
        {
            int caller = Environment.CurrentManagedThreadId, worker = 0, calls = 0;
            bool changedThread = false, wrongIndex = false, inheritedContext = false;
            var marker = new AsyncLocal<object>(); marker.Value = new object();
            Measure(i =>
            {
                int thread = Environment.CurrentManagedThreadId;
                if (worker == 0) worker = thread;
                if (worker != thread) changedThread = true;
                if (i != calls) wrongIndex = true;
                if (marker.Value != null) inheritedContext = true;
                calls++;
            });
            Assert.AreNotEqual(caller, worker);
            Assert.AreEqual(20200, calls);
            Assert.IsFalse(changedThread);
            Assert.IsFalse(wrongIndex);
            Assert.IsFalse(inheritedContext);
            Assert.IsNotNull(marker.Value, "caller context must be restored");
        }

        [Test]
        public void EmptyMeasuredBodyAllocatesExactlyZero()
        {
            Assert.AreEqual(0.0, Measure(i => { }));
        }

        [Test]
        public void OneObjectEveryCallExceedsTheUnchangedZeroBudget()
        {
            double bytes = Measure(i => sink = new object());
            GC.KeepAlive(sink);
            Assert.GreaterOrEqual(bytes, 24.0, "one real object per call cannot disappear into a noise allowance");
        }

        [Test]
        public void OneObjectAtTheFirstMeasuredIndexIsNotDiscarded()
        {
            double bytes = Measure(i => { if (i == 200) sink = new object(); });
            GC.KeepAlive(sink);
            Assert.GreaterOrEqual(bytes, 24.0 / 20000, "even a single measured allocation must remain counted");
        }

        [Test]
        public void MeasuredBodyExceptionReachesTheCallerUnchanged()
        {
            var expected = new InvalidOperationException("declared measurement control");
            int calls = 0;
            var actual = Assert.Throws<InvalidOperationException>(() => Measure(i =>
            {
                calls++;
                if (i == 200) throw expected;
            }));
            Assert.AreSame(expected, actual);
            Assert.AreEqual(201, calls);
        }
    }
}
