use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

#[wasm_bindgen]
pub struct ForceLayout {
    nodes: Vec<Node>,
    edges: Vec<Edge>,
    options: ForceOptions,
    step_count: u32,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Node {
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
    pub mass: f32,
    pub radius: f32,
    pub fixed: bool,
    pub fx: f32,
    pub fy: f32,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Edge {
    pub source: usize,
    pub target: usize,
    pub distance: f32,
    pub strength: f32,
}

#[derive(Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ForceOptions {
    pub attraction_strength: Option<f32>,
    pub repulsion_strength: Option<f32>,
    pub link_distance: Option<f32>,
    pub min_node_distance: Option<f32>,
    pub node_radius: Option<f32>,
    pub collision_strength: Option<f32>,
    pub damping: Option<f32>,
    pub gravity: Option<f32>,
    pub max_displacement: Option<f32>,
    pub time_step: Option<f32>,
    pub alpha: Option<f32>,
    pub alpha_decay: Option<f32>,
    pub theta: Option<f32>,
}

struct QuadTree {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    mass: f32,
    center_x: f32,
    center_y: f32,
    node_idx: Option<usize>,
    children: Option<Box<[Option<QuadTree>; 4]>>,
}

impl QuadTree {
    fn new(x: f32, y: f32, width: f32, height: f32) -> Self {
        Self {
            x,
            y,
            width,
            height,
            mass: 0.0,
            center_x: 0.0,
            center_y: 0.0,
            node_idx: None,
            children: None,
        }
    }

    fn insert(&mut self, node_idx: usize, nodes: &[Node]) {
        let n = &nodes[node_idx];
        if self.mass == 0.0 {
            self.mass = n.mass;
            self.center_x = n.x;
            self.center_y = n.y;
            self.node_idx = Some(node_idx);
            return;
        }

        self.center_x = (self.center_x * self.mass + n.x * n.mass) / (self.mass + n.mass);
        self.mass += n.mass;

        if let Some(old_idx) = self.node_idx.take() {
            self.insert_into_children(old_idx, nodes);
        }

        self.insert_into_children(node_idx, nodes);
    }

    fn insert_into_children(&mut self, idx: usize, nodes: &[Node]) {
        if self.children.is_none() {
            self.children = Some(Box::new([None, None, None, None]));
        }
        let children = self.children.as_mut().unwrap();

        let n = &nodes[idx];
        let hw = self.width / 2.0;
        let hh = self.height / 2.0;

        let left = n.x < self.x + hw;
        let top = n.y < self.y + hh;

        let child_idx = if top {
            if left { 0 } else { 1 }
        } else {
            if left { 2 } else { 3 }
        };

        if children[child_idx].is_none() {
            let (cx, cy) = match child_idx {
                0 => (self.x, self.y),
                1 => (self.x + hw, self.y),
                2 => (self.x, self.y + hh),
                3 => (self.x + hw, self.y + hh),
                _ => unreachable!(),
            };
            children[child_idx] = Some(QuadTree::new(cx, cy, hw, hh));
        }
        children[child_idx].as_mut().unwrap().insert(idx, nodes);
    }

    fn apply_repulsion(&self, ni_idx: usize, nodes: &mut [Node], opts: &ForceOptions, alpha: f32) {
        if self.mass == 0.0 { return; }

        if let Some(idx) = self.node_idx {
            if idx == ni_idx { return; }
        }

        let ni = &nodes[ni_idx];
        let mut dx = ni.x - self.center_x;
        let mut dy = ni.y - self.center_y;
        let mut dist2 = dx * dx + dy * dy;

        if dist2 == 0.0 {
            // Random jitter to avoid singularity
            dx = 0.1; // Simple jitter
            dy = 0.1;
            dist2 = dx * dx + dy * dy;
        }

        let dist = dist2.sqrt();

        if self.node_idx.is_some() || self.width / dist < opts.theta.unwrap_or(0.5) {
            let force = (opts.repulsion_strength.unwrap_or(300.0) * ni.mass * self.mass) / (dist + 1.0);

            let mut collision_force = 0.0;
            if let Some(nj_idx) = self.node_idx {
                let nj = &nodes[nj_idx];
                let effective_min_dist = opts.min_node_distance.unwrap_or(0.0) + ni.radius + nj.radius;
                if effective_min_dist > 0.0 && dist < effective_min_dist {
                    let overlap = effective_min_dist - dist;
                    collision_force = opts.collision_strength.unwrap_or(0.5) * overlap * 100.0;
                }
            }

            let total_force = force + collision_force;
            let fx = (dx / dist) * total_force * alpha;
            let fy = (dy / dist) * total_force * alpha;

            nodes[ni_idx].fx += fx;
            nodes[ni_idx].fy += fy;
        } else if let Some(children) = &self.children {
            for child in children.iter().flatten() {
                child.apply_repulsion(ni_idx, nodes, opts, alpha);
            }
        }
    }
}

#[wasm_bindgen]
impl ForceLayout {
    #[wasm_bindgen(constructor)]
    pub fn new(
        positions: &[f32],
        radii: &[f32],
        fixed: &[u8],
        sources: &[u32],
        targets: &[u32],
        options: JsValue,
    ) -> Result<ForceLayout, JsValue> {
        let opts: ForceOptions = serde_wasm_bindgen::from_value(options)?;
        let n_count = positions.len() / 2;
        
        let mut nodes = Vec::with_capacity(n_count);
        for i in 0..n_count {
            nodes.push(Node {
                x: positions[i * 2],
                y: positions[i * 2 + 1],
                vx: 0.0,
                vy: 0.0,
                mass: 1.0,
                radius: radii[i],
                fixed: fixed[i] == 1,
                fx: 0.0,
                fy: 0.0,
            });
        }

        let mut edges = Vec::with_capacity(sources.len());
        for i in 0..sources.len() {
            edges.push(Edge {
                source: sources[i] as usize,
                target: targets[i] as usize,
                distance: opts.link_distance.unwrap_or(80.0),
                strength: opts.attraction_strength.unwrap_or(0.1),
            });
        }

        Ok(ForceLayout {
            nodes,
            edges,
            options: opts,
            step_count: 0,
        })
    }

    pub fn step(&mut self) {
        let n_count = self.nodes.len();
        self.step_count += 1;

        // Reset forces
        for node in &mut self.nodes {
            node.fx = 0.0;
            node.fy = 0.0;
        }

        let alpha = self.options.alpha.unwrap_or(1.0);

        // 1) Repulsive forces
        if n_count > 0 {
            let mut min_x = f32::INFINITY;
            let mut min_y = f32::INFINITY;
            let mut max_x = f32::NEG_INFINITY;
            let mut max_y = f32::NEG_INFINITY;

            for node in &self.nodes {
                if node.x < min_x { min_x = node.x; }
                if node.x > max_x { max_x = node.x; }
                if node.y < min_y { min_y = node.y; }
                if node.y > max_y { max_y = node.y; }
            }

            let width = max_x - min_x;
            let height = max_y - min_y;
            let size = width.max(height) + 2.0;

            let mut tree = QuadTree::new(min_x - 1.0, min_y - 1.0, size, size);
            for i in 0..n_count {
                tree.insert(i, &self.nodes);
            }

            for i in 0..n_count {
                tree.apply_repulsion(i, &mut self.nodes, &self.options, alpha);
            }
        }

        // 2) Attractive forces
        for edge in &self.edges {
            let a_idx = edge.source;
            let b_idx = edge.target;
            
            let (dx, dy, dist) = {
                let a = &self.nodes[a_idx];
                let b = &self.nodes[b_idx];
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let dist = (dx * dx + dy * dy).sqrt().max(1e-6);
                (dx, dy, dist)
            };

            let f = edge.strength * (dist - edge.distance) * alpha;
            let fx = (dx / dist) * f;
            let fy = (dy / dist) * f;

            self.nodes[a_idx].fx += fx;
            self.nodes[a_idx].fy += fy;
            self.nodes[b_idx].fx -= fx;
            self.nodes[b_idx].fy -= fy;
        }

        // 3) Gravity
        let g = self.options.gravity.unwrap_or(0.1) * alpha;
        for node in &mut self.nodes {
            node.fx -= node.x * g * node.mass;
            node.fy -= node.y * g * node.mass;
        }

        // 4) Integrate
        let dt = self.options.time_step.unwrap_or(0.016);
        let damping = self.options.damping.unwrap_or(0.9);
        let max_disp = self.options.max_displacement.unwrap_or(100.0);

        for node in &mut self.nodes {
            if node.fixed {
                node.vx = 0.0;
                node.vy = 0.0;
                continue;
            }

            let ax = node.fx / node.mass;
            let ay = node.fy / node.mass;

            node.vx = (node.vx + ax * dt) * damping;
            node.vy = (node.vy + ay * dt) * damping;

            let mut dx = node.vx * dt;
            let mut dy = node.vy * dt;

            let disp = (dx * dx + dy * dy).sqrt();
            if disp > max_disp {
                let scale = max_disp / disp;
                dx *= scale;
                dy *= scale;
                node.vx = dx / dt;
                node.vy = dy / dt;
            }

            node.x += dx;
            node.y += dy;
        }

        // Cool alpha
        if let Some(mut current_alpha) = self.options.alpha {
            current_alpha *= 1.0 - self.options.alpha_decay.unwrap_or(0.02);
            self.options.alpha = Some(current_alpha);
        }
    }

    pub fn run_steps(&mut self, count: u32) {
        for _ in 0..count {
            self.step();
        }
    }

    pub fn get_positions(&self, out: &mut [f32]) {
        for i in 0..self.nodes.len() {
            out[i * 2] = self.nodes[i].x;
            out[i * 2 + 1] = self.nodes[i].y;
        }
    }
}
