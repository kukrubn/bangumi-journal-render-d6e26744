// Private, in-process transport for the existing typed database client. There is no HTTP route here.
type Command = { text: string; values: unknown[]; shape: "list" | "scalar" | "empty" };
type Execute = (query: Command) => Promise<unknown[]>;

type TableSpec = {
  fields: string;
  filters: string;
  select: string[];
  order: string[];
  conflicts: string[];
};

const tables: Record<string, TableSpec> = {
  library_entries: {
    fields: "id bangumi_id owner_id title_cn title_original cover_url platform meta_tags community_tags " +
      "total_episodes premiere_date end_date air_weekday release_pattern airing_override calendar_seen_on " +
      "metadata_fetched_at locked_fields watch_status watched_episodes personal_rating review last_watched_at",
    filters: "owner_id id bangumi_id version",
    select: ["*", "id"], order: ["id.asc"],
    conflicts: ["owner_id,id", "owner_id,bangumi_id"],
  },
  notes: {
    fields: "owner_id entry_id id body episode_number position_seconds", filters: "owner_id entry_id id version",
    select: ["*", "id"], order: [], conflicts: ["owner_id,id"],
  },
  watch_links: {
    fields: "owner_id entry_id id label url", filters: "owner_id entry_id id version",
    select: ["*", "id"], order: [], conflicts: ["owner_id,id"],
  },
  entry_tags: {
    fields: "", filters: "owner_id entry_id tag_id", select: [], order: [], conflicts: [],
  },
  sync_runs: {
    fields: "owner_id id username state last_error retry_at", filters: "owner_id id username state version",
    select: ["*"], order: ["updated_at.desc"], conflicts: ["owner_id,id"],
  },
  user_settings: {
    fields: "owner_id minutes_per_episode", filters: "owner_id version",
    select: ["minutes_per_episode,version"], order: [], conflicts: [],
  },
};

// Types and argument names copied from the deployed function signatures. Named notation preserves SQL defaults.
const functions: Record<string, { args: Record<string, string>; rows?: true }> = {
  is_app_owner: { args: {} },
  library_journal_index: { args: {} },
  backup_snapshot: { args: {} },
  bangumi_request_slot: { args: { p_backoff_seconds: "integer" }, rows: true },
  increment_progress: { args: { p_entry_id: "uuid", p_request_id: "uuid" }, rows: true },
  attach_entry_tag: { args: { p_entry_id: "uuid", p_name: "text" } },
  replace_episode_schedule: { args: { p_entry_id: "uuid", p_bangumi_id: "integer", p_previous_fetch: "timestamptz", p_episodes: "jsonb", p_calendar_weekday: "integer" } },
  apply_collection_page: { args: { p_run_id: "uuid", p_offset: "integer", p_count: "integer", p_total: "integer", p_rows: "jsonb" } },
  restore_backup: { args: { p_changes: "jsonb", p_revision: "text" } },
};

function valid(condition: unknown): asserts condition {
  if (!condition) throw new Error("Unsupported internal database operation");
}

function command(
  url: URL, method: string, payload: Record<string, unknown>, prefer: string, uid: string,
): Command {
  const values: unknown[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const path = url.pathname.split("/").slice(3);
  valid(url.origin === "https://journal.invalid" && url.pathname.startsWith("/rest/v1/"));
  if (path[0] === "rpc") {
    const name = path[1];
    valid(path.length === 2 && method === "POST" && !url.search && Object.hasOwn(functions, name));
    const fn = functions[name];
    const args = Object.entries(payload).map(([key, value]) => {
      valid(Object.hasOwn(fn.args, key));
      const type = fn.args[key];
      return `${key} => ${bind(type === "jsonb" ? JSON.stringify(value) : value)}::${type}`;
    });
    const invocation = `public.${name}(${args.join(", ")})`;
    return fn.rows
      ? { text: `SELECT to_jsonb(r) AS data FROM ${invocation} AS r`, values, shape: "list" }
      : { text: `SELECT to_jsonb(${invocation}) AS data`, values, shape: "scalar" };
  }

  const name = path[0];
  valid(path.length === 1 && Object.hasOwn(tables, name));
  const spec = tables[name];
  const fields = spec.fields.split(" ");
  const filters = spec.filters.split(" ");
  const projection = url.searchParams.get("select");
  valid(projection === null || spec.select.includes(projection));
  const predicates: string[] = [];
  for (const [field, expr] of url.searchParams) {
    if (["select", "order", "limit", "on_conflict"].includes(field)) continue;
    valid(filters.includes(field));
    if (expr.startsWith("eq.")) predicates.push(`${field} = ${bind(expr.slice(3))}`);
    else if (field === "id" && expr.startsWith("gt.")) predicates.push(`id > ${bind(expr.slice(3))}`);
    else {
      valid((field === "state" || field === "bangumi_id") && /^in\.\([\w,]+\)$/.test(expr));
      predicates.push(`${field} IN (${expr.slice(4, -1).split(",").map(bind).join(", ")})`);
    }
  }
  const target = `public.${name}`;
  const where = predicates.length ? " WHERE " + predicates.join(" AND ") : "";
  if (method !== "POST") valid(url.searchParams.get("owner_id") === `eq.${uid}`);
  const order = url.searchParams.get("order");
  const limit = url.searchParams.get("limit");
  const conflict = url.searchParams.get("on_conflict");
  let sql: string;
  if (method === "GET") {
    valid(projection && !conflict);
    sql = `SELECT to_jsonb(result) AS data FROM (SELECT ${projection} FROM ${target}${where}) AS result`;
    if (order) {
      valid(spec.order.includes(order));
      const [field, direction] = order.split(".");
      sql += ` ORDER BY ${field} ${direction}`;
    }
    if (limit) {
      valid(/^\d{1,3}$/.test(limit));
      sql += ` LIMIT ${bind(limit)}`;
    }
    return { text: sql, values, shape: "list" };
  } else {
    valid(!order && !limit);
    const entries = Object.entries(payload);
    valid(entries.every(([key]) => fields.includes(key) && key.length > 0));
    if (method === "POST") {
      valid(!where && payload.owner_id === uid);
      const keys = entries.map(([key]) => key).join(", ");
      sql = `INSERT INTO ${target} (${keys}) VALUES (${entries.map(([, v]) => bind(v)).join(", ")})`;
      if (conflict) {
        valid(spec.conflicts.includes(conflict) && prefer.includes("resolution=ignore-duplicates"));
        sql += ` ON CONFLICT (${conflict}) DO NOTHING`;
      }
    } else {
      valid(!conflict && predicates.length >= 2);
      if (method === "PATCH") {
        valid(entries.length && entries.every(([key]) => !["owner_id", "id", "entry_id"].includes(key)));
        sql = `UPDATE ${target} SET ${entries.map(([key,v]) => `${key} = ${bind(v)}`).join(", ")}${where}`;
      } else {
        valid(method === "DELETE" && !entries.length);
        sql = `DELETE FROM ${target}${where}`;
      }
    }
    if (!projection) return { text: sql, values, shape: "empty" };
    sql += ` RETURNING ${projection}`;
  }
  // PostgreSQL's own JSON encoding keeps bigint versions numeric and calendar dates in YYYY-MM-DD.
  return { text: `WITH result AS (${sql}) SELECT to_jsonb(result) AS data FROM result`, values, shape: "list" };
}

export function postgresTransport(uid: string, execute: Execute): typeof fetch {
  return async (input, init) => {
    try {
      const request = new Request(input, init);
      const payload = request.body ? await request.json() : {};
      valid(payload && typeof payload === "object" && !Array.isArray(payload));
      const query = command(new URL(request.url), request.method, payload, request.headers.get("prefer") ?? "", uid);
      const rows = await execute(query);
      if (query.shape === "empty") return new Response(null, { status: 204 });
      if (query.shape === "scalar") return Response.json(rows[0]);
      if (request.headers.get("accept") === "application/vnd.pgrst.object+json") {
        if (rows.length !== 1) return Response.json({ code: "PGRST116", message: "Expected one row" }, { status: 406 });
        return Response.json(rows[0]);
      }
      return Response.json(rows);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "JOURNAL_DB";
      // Never propagate connection strings, server addresses or row contents to the client.
      return Response.json({ code, message: "Database operation failed" }, { status: 400 });
    }
  };
}
