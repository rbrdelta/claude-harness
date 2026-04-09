---
task: d2-diagram-system
title: "Diagram system as native component type within design system"
project: rowbyroh-website
autonomous: false
complexity: medium
evaluation_skill: designer
branch: feature/diagram-system
work_dir: ~/projects/active/web/rowbyroh-website

inputs:
  - path: assets/css/base.css
    why: design tokens, spacing model, responsive breakpoints — diagrams must use these
  - path: exploration/UI-KIT.md
    why: signed-off visual identity — material palette, zone colors, font schema
  - path: assets/css/style.css
    why: homepage styles — diagrams may appear on content pages that extend this
  - path: index.html
    why: current page structure — understand the alignment grid and content width
  - path: CLAUDE.md
    why: Site Design Rubric, proportionality model, standalone page template

outputs:
  - type: css
    description: diagram component styles using only base.css tokens
  - type: html
    description: diagram markup pattern (reusable component structure)
  - type: proof
    description: import pipeline diagram rebuilt using the new component system

acceptance:
  - criterion: "Diagram component uses only base.css CSS custom properties for spacing"
    verify: "grep for margin/padding/gap values in diagram CSS — all must reference var(--"
  - criterion: "No diagram-specific media queries"
    verify: "grep -c '@media' in diagram CSS returns 0"
  - criterion: "Same content width as text content"
    verify: "diagram max-width matches content max-width in base.css"
  - criterion: "Import pipeline diagram renders without errors"
    verify: "file exists and contains valid HTML structure"
  - criterion: "Mobile layout works without special-case CSS"
    verify: "no diagram-specific responsive overrides"

integration_points:
  - system: base.css
    concern: spacing tokens must be sufficient for diagram layout — may need new tokens added to base.css following existing naming convention
  - system: content pages (agentic-stack.html, obsidian-mcp.html)
    concern: diagram component must work inside existing standalone page template structure
  - system: style.css
    concern: no cascade conflicts between diagram component CSS and existing page styles
  - system: scroll.js
    concern: diagrams should not interfere with scroll indicator behavior
---

## Context

D1 explored diagram visual concepts and validated the look: architectural vellum, green accent, leadholder construction lines, dark/light material inversion. The visual concept works. The implementation doesn't fit the system — SVG coordinate system fights CSS rem-based spacing, 140% breakout creates mobile alignment issues, spacing requires duct-tape fixes.

D2 rebuilds the foundation. The diagram system must share the same primitives as the rest of the site: same spacing tokens, same responsive model, same CSS primitives, same alignment grid.

### D1 learnings (from sprint handoff):
- SVG-based diagrams require their own coordinate system — this fights the CSS rem model
- Breakout widths (wider than content) create alignment issues on mobile
- The visual concept is validated but needs a CSS-native implementation approach
- Tagged as `diagram-d1-draft` for reference

### Key constraint:
This is a `/designer + /architect` planning task first. The diagram component model needs to be designed before it can be built. Set `autonomous: false` until the Decision Document is complete.

### After planning produces a Decision Document:
- Set `autonomous: true`
- Add `decision_document` path
- Re-compile to generate the sprint script
