# Chest log runs

Chest Log pastes can cover more than one fight. Rows are grouped into runs by timestamp, each run splits its own loot, and Discord stays one message for the whole paste.

## Clustering

- Sort parsed rows by chest date, then file order.
- Gap **> 10 minutes** from the previous row starts a new run. `x` and `x+9 min` stay together. Exact 10 minutes stays together.
- Unparseable dates stay with the previous run (or open the first run).
- Aggregate stacks **inside each run**, not across the whole log.
- Trash still dropped per run.

## Shared vs per run

**Top of the form (once):** server, city, price basis, repair, seller buffer tax, guild tax, premium.

**Each run:** participant count (default 5, editable) and optional names.

Repair is one number. That **full amount is deducted from every run**. Tax percents apply to each run’s own gross.

## Pipeline

One Calculate: one market lookup for all unique items, then price and split each run. Session gross = sum of run gross. Session net = sum of run nets (repair counted on every run).

## Output

- Results: session totals, then a block per run (time range, net, names, items).
- Discord: one message — session gross/net, then each run. A single-run paste keeps the existing Discord shape (no extra Run wrapper).
- History/JSON: store per-run participant drafts. Old exports without `runs` become one run from the old global count/names.

Calculator tab is unchanged.
