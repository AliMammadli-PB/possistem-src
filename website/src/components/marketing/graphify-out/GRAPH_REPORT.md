# Graph Report - marketing  (2026-09-04)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 91 nodes · 124 edges · 13 communities (7 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- T.tsx
- SiteHeader.tsx
- MarketingLayout.tsx
- PublicChatRoom.tsx
- ShowcaseActivityMock.tsx
- ShowcaseDownloadsMock.tsx
- HardwareCatalog.tsx
- ProductTabs.tsx
- ReleaseCard.tsx
- AnimatedCounter.tsx
- ProductTabsBar.tsx
- ThemePicture.tsx

## God Nodes (most connected - your core abstractions)
1. `T()` - 14 edges
2. `PublicChatRoom()` - 5 edges
3. `CustomerAccountMenu()` - 3 edges
4. `avClass()` - 3 edges
5. `initials()` - 3 edges
6. `MsgAvatar()` - 3 edges
7. `formatSyncLabel()` - 2 edges
8. `ShowcaseWhatsAppMock()` - 2 edges
9. `CartDrawer()` - 2 edges
10. `CartToggle()` - 2 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (13 total, 5 thin omitted)

### Community 0 - "T.tsx"
Cohesion: 0.15
Nodes (9): FieldErrors, FieldName, ShowcaseMockCardProps, ChannelId, formatSyncLabel(), ShowcaseWhatsAppMock(), articles, T() (+1 more)

### Community 1 - "SiteHeader.tsx"
Cohesion: 0.17
Nodes (9): CartDrawer(), CartToggle(), CustomerAccountMenu(), initialsFrom(), LANGUAGES, LanguageSelector(), navItems, SiteHeader() (+1 more)

### Community 2 - "MarketingLayout.tsx"
Cohesion: 0.22
Nodes (6): FloatingWhatsApp(), MarketingLayoutProps, RevealObserver(), ScrollRestoration(), SiteFooter(), SkipLink()

### Community 3 - "PublicChatRoom.tsx"
Cohesion: 0.33
Nodes (7): avClass(), formatCooldown(), highlightMentions(), initials(), MsgAvatar(), PublicChatRoom(), TOPIC_CATEGORIES

### Community 4 - "ShowcaseActivityMock.tsx"
Cohesion: 0.29
Nodes (6): FEED, FeedItem, FeedTone, formatSyncLabel(), ShowcaseActivityMock(), TabId

### Community 5 - "ShowcaseDownloadsMock.tsx"
Cohesion: 0.50
Nodes (3): formatFileLine(), REQUIREMENTS, ShowcaseDownloadsMock()

### Community 8 - "ReleaseCard.tsx"
Cohesion: 0.67
Nodes (3): parseRelease(), ReleaseCard(), ReleaseInfo

## Knowledge Gaps
- **22 isolated node(s):** `FieldErrors`, `FieldName`, `ShowcaseMockCardProps`, `ChannelId`, `TProps` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 39 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `T()` connect `T.tsx` to `SiteHeader.tsx`, `MarketingLayout.tsx`, `PublicChatRoom.tsx`, `ShowcaseActivityMock.tsx`, `ShowcaseDownloadsMock.tsx`, `HardwareCatalog.tsx`, `ReleaseCard.tsx`?**
  _High betweenness centrality (0.270) - this node is a cross-community bridge._
- **What connects `FieldErrors`, `FieldName`, `ShowcaseMockCardProps` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._