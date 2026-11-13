Morphing board makes me think. What if board have e.g. 3 perspectives that user can switch. Freeflows with lines, bord view, maybe graph or something else? When I create i use free flow, when i plan I use board and similar. Wdyt? 1 idea planes could mix in this somehow

That’s the core principle, and it’s a good one: Flow is allowed to be messy, and order lives elsewhere. It matches the research too. People think best when the tool doesn’t force them to decide structure while they’re still figuring things out.

A few consequences worth holding onto:

Flow never nags. No “set a status”, no required fields, no warnings about unsorted items. A sticky is just a sticky.
Order is applied, not imposed. You open Board and see an “Unsorted” lane with everything from Flow. Sorting happens there, when you’re in planning mode.
Order never breaks the mess. Moving a card in Board or Timeline doesn’t move it in Flow. Your creative layout stays exactly as you left it, so you can always go back to the original thinking.
Flow can still show order quietly. A small status dot or due badge on a card, so you can see what’s been planned without the layout changing.
Some items never get order, and that’s fine. Notes, references and ideas can live only in Flow. Board and Timeline only show what has been promoted, or show the rest in a collapsed “not planned” area.
That gives you a clean line: Flow is for thinking, the other perspectives are for deciding. It’s also a clear pitch for the extension: “Think freely, then switch to plan.”

Do you have sessions that you work with konekton code in memory?

No. Memory is on, but nothing has been saved yet, and there’s no record of earlier sessions where I worked on Konekton’s code. In this conversation I’ve only seen the README you attached.

If you want me to work with the actual code, you can:

give me the GitHub repository (owner/name) and I can attach it here,
upload the source files or a zip,
or link this chat to your computer through the Claude desktop app, so I can reach the project folder directly.
Rules: chaos shows all, this could become multiple plans and timelines. Plans and timelines can omit items. Chaos decides what can advance. Wdyt?

Modeling chaos as the source behind multiple plans and timelines.
Modeling chaos as the source behind multiple plans and timelines.
I like it. It gives a clean hierarchy: Chaos is the single source of everything. Plans and timelines are selections from it. That’s simple to explain and simple to build.

What it implies:

Every item lives in Chaos. Creating a card inside a plan also puts it in Chaos, so nothing exists only in a plan.
Removing from a plan only removes it from that plan. Deleting in Chaos deletes it everywhere. This gives people the safety to experiment with plans.
Many plans, one pool. “Kitchen renovation” board, “Q4 work” board, “This week” timeline, all pulling from the same Chaos.
One tension to resolve: earlier we said Chaos shouldn’t try to solve order. “Chaos decides what can advance” is fine if advancing is one lightweight gesture (mark a card as “ready”, or drag it onto a plan’s icon), not filling in fields. Chaos says yes, this matters. The plan decides where, when and how.

Questions you’ll need to answer:

Can one item be in two plans? I’d say yes, for example “Call plumber” in both “Renovation” and “This week”.
Is status shared or per plan? I’d make done global (done is done everywhere), and keep lane and order per plan.
Can a plan pull items without the Chaos gate? If plans can only take “ready” items, the gate matters. If anything can be pulled, the gate is just a hint. A strict gate is cleaner, but may feel annoying when you just want to drag something in.
What does Chaos show about advanced items? Probably a small badge with the plans it’s in, and finished items faded instead of hidden.
Data model: plans can be stored as views inside the same .canvas file, for example konekton.views: [{ id, type: "board" | "timeline", name, items: [nodeIds], lanes, order }]. Chaos stays the normal JSON Canvas nodes, so the file remains valid, and plans are just lists of references to them.

Yes.
Status shared
I think yes - if there is node connection then it should e en automatically ask to pull others, connected?
Some small indicators
Planning a design proposal with status and lane updates.
Planning a design proposal with status and lane updates.
Good, that settles the model. A few notes on each:

1. Items in several plans: no catch here, just show the plan badges in Chaos.

2. Shared status: this means a board’s lanes are usually status lanes (Todo / Doing / Done), and moving a card there updates it everywhere. If you later want lanes by something else, like room or person, those lanes would belong to the plan, while status stays shared. You don’t need that in version 1.

3. Pulling connected items: this is a nice touch, because it makes the lines in Chaos useful later. How I’d design it:

You drag “Renovate kitchen” into a plan. A small prompt appears: “Also add 4 connected items?” with a checklist of them, all ticked.
One step deep by default. Following connections further could pull half the board in.
Arrow direction can matter. Items the card points to (sub-steps) are pre-ticked. Items pointing to it, or with no arrow, are listed but unticked.
Already-included items are skipped silently.
Not naggy: an option in the prompt to “always add connected” or “never ask” for this plan, so it doesn’t interrupt every drag.
In a timeline, an arrow can also show ordering: if A points to B, B shouldn’t be scheduled before A. You could show a warning instead of enforcing it.
4. Small indicators in Chaos: for example a tiny dot per plan (in the plan’s color), a checkmark or fade for done, and maybe a red dot for overdue. Hovering shows the plan names, and clicking one jumps into that plan with the card selected.

The model is now coherent: Chaos holds everything, connections express meaning, plans select and order, and status is one shared truth. I’d write this up as a short design doc next, so you have the rules in one place before coding. Want that?