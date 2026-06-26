impl McpServer {
  pub fn get_tools(&self) -> Vec<McpTool> {
    let mut tools = self.get_tools_part1();
    tools.extend(self.get_tools_part2());
    tools
  }
}

include!("tools_part1.rs");
include!("tools_part2.rs");
