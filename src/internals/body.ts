/**
 * Whether `value` is safe to pass to `JSON.stringify`. Not just `typeof === 'object'` — a
 * `Map`/`Set`/plain class instance would silently stringify to `"{}"`, losing the data.
 */
export function isJsonSerializable(value: unknown): boolean {
  if (value === undefined) return false;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean' || value === null) return true;
  if (type !== 'object') return false; // bigint, function, symbol
  if (Array.isArray(value)) return true;
  // tsc(TS2638) requires this assertion even though the linter's type-aware check disagrees.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  if ('buffer' in (value as object)) return false; // duck-types out TypedArray, etc.
  if (value instanceof FormData || value instanceof URLSearchParams) return false;

  const ctor = (value as { constructor?: { name?: string } }).constructor;
  const toJson = (value as { toJSON?: unknown }).toJSON;
  return ctor?.name === 'Object' || typeof toJson === 'function';
}

export interface SerializedBody {
  body: BodyInit | undefined;
  /** `string`: set/overwrite Content-Type with this value. `null`: remove the Content-Type header (so the runtime generates FormData's boundary itself). `undefined`: leave it untouched. */
  contentType: string | null | undefined;
}

/** Decides how to serialize `body` from its type *and* any Content-Type already set — not the type alone. */
export function serialize(body: unknown, contentType: string | undefined): SerializedBody {
  if (body == null) return { body: undefined, contentType: undefined };

  if (body instanceof Blob) {
    return { body, contentType: undefined }; // the runtime sets this from blob.type
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return { body: body as BodyInit, contentType: contentType ?? 'application/octet-stream' };
  }
  if (body instanceof URLSearchParams) {
    return { body: body.toString(), contentType: 'application/x-www-form-urlencoded;charset=UTF-8' };
  }
  if (body instanceof FormData) {
    return { body, contentType: null }; // never set the multipart boundary by hand
  }
  if (body instanceof ReadableStream) {
    return { body: body as BodyInit, contentType: undefined };
  }
  if (typeof body === 'string') {
    return { body, contentType };
  }

  if (typeof body === 'object') {
    if (contentType?.includes('application/x-www-form-urlencoded')) {
      return {
        body: new URLSearchParams(body as Record<string, string>).toString(),
        contentType,
      };
    }
    if (contentType?.includes('multipart/form-data')) {
      const form = new FormData();
      for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        form.append(key, value as string | Blob);
      }
      return { body: form, contentType: null }; // clear the boundary-less header so the runtime makes a new one
    }
    if (isJsonSerializable(body)) {
      return { body: JSON.stringify(body), contentType: contentType ?? 'application/json;charset=UTF-8' };
    }
    // Not JSON-serializable and no explicit hint — pass through as-is, caller/runtime decides.
    return { body: body as BodyInit, contentType };
  }

  // Only number/boolean/bigint/symbol/function reach here (object/string/null/undefined are all
  // handled above), and each has its own real toString(), so there's no '[object Object]' risk.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return { body: String(body), contentType: contentType ?? 'text/plain;charset=UTF-8' };
}

const encoder = new TextEncoder();
// Rough overhead per multipart field: boundary line + Content-Disposition header, etc.
const APPROX_FORM_FIELD_OVERHEAD = 64;

/**
 * Estimates the byte size of a serialized body, for upload progress's `total`. Computed here,
 * right after serialization, because `Content-Length` is a forbidden request header per the
 * fetch spec and can't be read back off a constructed `Request`.
 */
export function getSize(body: BodyInit | undefined): number {
  if (!body) return 0;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof body === 'string') return encoder.encode(body).byteLength;
  if (body instanceof URLSearchParams) return encoder.encode(body.toString()).byteLength;
  if (body instanceof FormData) {
    let size = 0;
    for (const [key, value] of body) {
      size += APPROX_FORM_FIELD_OVERHEAD;
      size += encoder.encode(`Content-Disposition: form-data; name="${key}"`).byteLength;
      size += typeof value === 'string' ? encoder.encode(value).byteLength : value.size;
    }
    return size;
  }
  return 0; // ReadableStream, etc. — unknowable ahead of time
}
