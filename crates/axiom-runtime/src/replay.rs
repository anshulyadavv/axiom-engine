use axiom_core::{AxiomError, SemanticEvent};
use serde_json::Value;

#[derive(Debug)]
pub struct ReplayCursor {
    history: Vec<SemanticEvent>,
    index: usize,
}

impl ReplayCursor {
    pub fn new(history: Vec<SemanticEvent>) -> Self {
        Self { history, index: 0 }
    }

    pub fn peek_event(&self) -> Option<&SemanticEvent> {
        self.history.get(self.index)
    }

    pub fn consume_event(&mut self) -> Option<&SemanticEvent> {
        if self.index < self.history.len() {
            let evt = &self.history[self.index];
            self.index += 1;
            Some(evt)
        } else {
            None
        }
    }

    pub fn is_exhausted(&self) -> bool {
        self.index >= self.history.len()
    }
}
