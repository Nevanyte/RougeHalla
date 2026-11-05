use super::{dist2, Node};
pub type Edge = [usize; 2];
fn distance(nodes: &[Node], a: usize, b: usize) -> f64 {
    dist2(nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y)
}
pub fn prim_mst(nodes: &[Node], root: isize) -> Vec<Edge> {
    let n = nodes.len();
    let mut edges = Vec::new();
    if root < 0 || root as usize >= n {
        return edges;
    }
    let mut inside = vec![false; n];
    inside[root as usize] = true;
    for _ in 1..n {
        let mut best = None;
        let mut bd = f64::INFINITY;
        for u in 0..n {
            if !inside[u] {
                continue;
            }
            for (v, &is_inside) in inside.iter().enumerate() {
                if is_inside {
                    continue;
                }
                let d = distance(nodes, u, v);
                let (a, b) = (u.min(v), u.max(v));
                if d < bd || (d == bd && best.is_some_and(|(ba, bb, _)| (a, b) < (ba, bb))) {
                    bd = d;
                    best = Some((a, b, v));
                }
            }
        }
        let Some((a, b, v)) = best else { break };
        edges.push([a, b]);
        inside[v] = true;
    }
    edges
}
pub fn rng_edges(nodes: &[Node]) -> Vec<Edge> {
    let mut out = Vec::new();
    for a in 0..nodes.len() {
        for b in a + 1..nodes.len() {
            let len = distance(nodes, a, b);
            if !(0..nodes.len())
                .any(|k| k != a && k != b && distance(nodes, k, a).max(distance(nodes, k, b)) < len)
            {
                out.push([a, b]);
            }
        }
    }
    out
}
/// Appends to edges and returns only additions. Ratios are recomputed after each insertion.
pub fn add_shortcuts(
    nodes: &[Node],
    edges: &mut Vec<Edge>,
    max: usize,
    min_ratio: f64,
    max_len: f64,
) -> Vec<Edge> {
    let n = nodes.len();
    let mut added = Vec::new();
    let mut d = vec![f64::INFINITY; n * n];
    for _ in 0..max {
        d.fill(f64::INFINITY);
        for i in 0..n {
            d[i * n + i] = 0.0
        }
        for &[a, b] in edges.iter() {
            let len = crate::math::sqrt(distance(nodes, a, b));
            if len < d[a * n + b] {
                d[a * n + b] = len;
                d[b * n + a] = len
            }
        }
        for k in 0..n {
            for i in 0..n {
                let ik = d[i * n + k];
                if ik == f64::INFINITY {
                    continue;
                }
                for j in 0..n {
                    let v = ik + d[k * n + j];
                    if v < d[i * n + j] {
                        d[i * n + j] = v
                    }
                }
            }
        }
        let mut linked = vec![false; n * n];
        for &[a, b] in edges.iter() {
            linked[a * n + b] = true;
            linked[b * n + a] = true
        }
        let (mut best, mut br) = (None, 0.0);
        for a in 0..n {
            for b in a + 1..n {
                if linked[a * n + b] {
                    continue;
                }
                let d2 = distance(nodes, a, b);
                if d2 == 0.0 || d2 > max_len * max_len {
                    continue;
                }
                let ratio = d[a * n + b] / crate::math::sqrt(d2);
                if ratio >= min_ratio && ratio > br {
                    br = ratio;
                    best = Some([a, b])
                }
            }
        }
        let Some(e) = best else { break };
        edges.push(e);
        added.push(e);
    }
    added
}
pub fn cyclomatic(node_count: usize, edges: &[Edge]) -> isize {
    let mut parent: Vec<_> = (0..node_count).collect();
    fn find(p: &mut [usize], mut i: usize) -> usize {
        while p[i] != i {
            p[i] = p[p[i]];
            i = p[i]
        }
        i
    }
    let mut comps = node_count;
    for &[a, b] in edges {
        let (ra, rb) = (find(&mut parent, a), find(&mut parent, b));
        if ra != rb {
            parent[ra.max(rb)] = ra.min(rb);
            comps -= 1
        }
    }
    edges.len() as isize - node_count as isize + comps as isize
}
