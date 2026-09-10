import { readFileSync } from 'node:fs'
import type { ConnectionOptions } from 'node:tls'

import { Client, type ClientOptions, Filter, InvalidCredentialsError, InvalidDNSyntaxError, NoSuchObjectError, ResultCodeError, type Entry } from 'ldapts'

import type { Env } from '@/lib/env'

/**
 * The corporate directory, as the application talks to it.
 *
 * One interface, `Directory`, with one question: "is this username and
 * password a real person, and who are they?" The `ldapts` implementation below
 * answers it against LDAP / Active Directory; the tests answer it from a fake.
 * Nothing above this module knows which one it is talking to, and nothing in
 * this module knows about users, roles or sessions - it returns a
 * `DirectoryIdentity` and forgets the password.
 *
 * Two shapes of directory access are supported, chosen by configuration:
 *
 *  - Service account: bind as `LDAP_BIND_DN`, search `LDAP_USER_BASE_DN` for
 *    the user with an escaped filter, then bind as the entry's DN with the
 *    typed password. The usual Active Directory pattern.
 *  - Direct bind: no service account; bind as `<username>@<LDAP_UPN_SUFFIX>`
 *    with the typed password, then search for the entry as that user.
 *
 * Either way the password is used for exactly one bind and is never stored,
 * logged or returned. The connection is always TLS: `ldaps://`, or `ldap://`
 * upgraded with StartTLS before anything is sent. Certificate validation is
 * never switched off; an internal CA is trusted by pointing `LDAP_TLS_CA_FILE`
 * (or `NODE_EXTRA_CA_CERTS`) at its bundle.
 */

export interface DirectoryIdentity {
  /** The stable identifier the local account is linked by (objectGUID as a UUID string, by default). */
  id: string
  /** The sign-in name as the directory spells it, lower-cased. */
  username: string
  dn: string
  displayName: string | null
  email: string | null
  staffId: string | null
  /** Group DNs the user is a member of, lower-cased for comparison. */
  groups: string[]
}

export type DirectoryAuthResult =
  | { ok: true; identity: DirectoryIdentity }
  /** Wrong password, no such user, or more than one match - all the same answer. */
  | { ok: false; reason: 'invalid' }
  /** The directory could not be reached or did not answer in time. */
  | { ok: false; reason: 'unavailable' }
  /** The directory answered, but with something that means our configuration is wrong. */
  | { ok: false; reason: 'misconfigured' }

export interface Directory {
  authenticate(username: string, password: string): Promise<DirectoryAuthResult>
}

export interface DirectorySettings {
  url: string
  startTls: boolean
  tlsCaFile: string | null
  tlsServername: string | null
  timeoutMs: number
  userBaseDn: string
  bindDn: string | null
  bindPassword: string | null
  upnSuffix: string | null
  userFilter: string
  idAttribute: string
  usernameAttribute: string
  nameAttribute: string
  emailAttribute: string
  staffIdAttribute: string | null
  groupAttribute: string
}

/** The connection and search settings, in one object the client can be built from. */
export function directorySettingsFrom(values: Env): DirectorySettings {
  const userBaseDn = values.LDAP_USER_BASE_DN ?? values.LDAP_BASE_DN
  if (!values.LDAP_URL || !userBaseDn) {
    throw new Error('Directory sign-in is enabled without LDAP_URL and a user base DN. env.ts should have refused this.')
  }
  return {
    url: values.LDAP_URL,
    startTls: values.LDAP_STARTTLS,
    tlsCaFile: values.LDAP_TLS_CA_FILE ?? null,
    tlsServername: values.LDAP_TLS_SERVERNAME ?? null,
    timeoutMs: values.LDAP_TIMEOUT_MS,
    userBaseDn,
    bindDn: values.LDAP_BIND_DN ?? null,
    bindPassword: values.LDAP_BIND_PASSWORD ?? null,
    upnSuffix: values.LDAP_UPN_SUFFIX ?? null,
    userFilter: values.LDAP_USER_FILTER,
    idAttribute: values.LDAP_ID_ATTRIBUTE,
    usernameAttribute: values.LDAP_USERNAME_ATTRIBUTE,
    nameAttribute: values.LDAP_NAME_ATTRIBUTE,
    emailAttribute: values.LDAP_EMAIL_ATTRIBUTE,
    staffIdAttribute: values.LDAP_STAFF_ID_ATTRIBUTE || null,
    groupAttribute: values.LDAP_GROUP_ATTRIBUTE,
  }
}

// -----------------------------------------------------------------------------
// Pure helpers: the parts worth unit-testing without a directory
// -----------------------------------------------------------------------------

/**
 * The characters a sign-in name may contain. Anything else is refused before
 * the directory is contacted: a name is not a place for filter syntax, DN
 * syntax or control characters, and refusing early costs nothing.
 */
const USERNAME_PATTERN = /^[a-z0-9._'@\-\\]+$/i

export function isPlausibleUsername(value: string): boolean {
  return value.length > 0 && value.length <= 254 && USERNAME_PATTERN.test(value)
}

/**
 * Builds the search filter from the configured template. The typed name is
 * escaped per RFC 4515 wherever `{{username}}` appears, so `*`, parentheses,
 * backslashes and NUL bytes are literal characters in the search, never syntax.
 */
export function buildUserFilter(template: string, username: string): string {
  const escaped = Filter.escape(username)
  return template.split('{{username}}').join(escaped)
}

/**
 * `DOMAIN\user` and `user@domain` both mean "user" to the search filter, which
 * matches on sAMAccountName / UPN / mail. The account part alone is what a
 * direct bind is built from.
 */
export function accountNameOf(username: string): string {
  const backslash = username.lastIndexOf('\\')
  const withoutDomain = backslash >= 0 ? username.slice(backslash + 1) : username
  const at = withoutDomain.indexOf('@')
  return at >= 0 ? withoutDomain.slice(0, at) : withoutDomain
}

/** Active Directory stores objectGUID as 16 bytes; this is its usual textual form. */
export function formatObjectGuid(bytes: Buffer): string {
  if (bytes.length !== 16) return bytes.toString('hex')
  const hex = (start: number, end: number) => bytes.subarray(start, end).toString('hex')
  // The first three fields are little-endian.
  const swap = (start: number, end: number) => Buffer.from(bytes.subarray(start, end)).reverse().toString('hex')
  return `${swap(0, 4)}-${swap(4, 6)}-${swap(6, 8)}-${hex(8, 10)}-${hex(10, 16)}`
}

/** Active Directory stores objectSid in binary; this is the S-1-5-21-... form. */
export function formatObjectSid(bytes: Buffer): string {
  if (bytes.length < 8) return bytes.toString('hex')
  const revision = bytes[0]
  const subAuthorityCount = bytes[1]
  const authority = bytes.readUIntBE(2, 6)
  const parts = [`S-${revision}-${authority}`]
  for (let index = 0; index < subAuthorityCount && 8 + index * 4 + 4 <= bytes.length; index += 1) {
    parts.push(String(bytes.readUInt32LE(8 + index * 4)))
  }
  return parts.join('-')
}

function firstValue(entry: Entry, attribute: string): Buffer | string | null {
  // Attribute names are case-insensitive in LDAP; the server may not echo our casing.
  const key = Object.keys(entry).find((candidate) => candidate.toLowerCase() === attribute.toLowerCase())
  if (!key) return null
  const value = entry[key]
  if (Array.isArray(value)) return (value[0] as Buffer | string | undefined) ?? null
  return value as Buffer | string
}

function allValues(entry: Entry, attribute: string): string[] {
  const key = Object.keys(entry).find((candidate) => candidate.toLowerCase() === attribute.toLowerCase())
  if (!key) return []
  const value = entry[key]
  const list = Array.isArray(value) ? value : [value]
  return list.map((item) => (Buffer.isBuffer(item) ? item.toString('utf8') : String(item)))
}

function textOf(value: Buffer | string | null): string | null {
  if (value === null) return null
  const text = (Buffer.isBuffer(value) ? value.toString('utf8') : value).trim()
  return text.length > 0 ? text : null
}

/** The stable id as text: binary GUIDs and SIDs get their canonical form, anything else its string. */
export function stableIdOf(entry: Entry, attribute: string): string | null {
  const value = firstValue(entry, attribute)
  if (value === null) return null
  if (Buffer.isBuffer(value)) {
    const lower = attribute.toLowerCase()
    if (lower === 'objectguid') return formatObjectGuid(value)
    if (lower === 'objectsid') return formatObjectSid(value)
    return value.toString('hex')
  }
  const text = value.trim()
  return text.length > 0 ? text : null
}

/** Turns one directory entry into the identity the application keeps. Null when it lacks a stable id. */
export function identityFromEntry(entry: Entry, settings: DirectorySettings, typedUsername: string): DirectoryIdentity | null {
  const id = stableIdOf(entry, settings.idAttribute)
  if (!id) return null
  const username = textOf(firstValue(entry, settings.usernameAttribute))?.toLowerCase() ?? accountNameOf(typedUsername)
  const email = textOf(firstValue(entry, settings.emailAttribute))?.toLowerCase() ?? null
  return {
    id,
    username,
    dn: entry.dn,
    displayName: textOf(firstValue(entry, settings.nameAttribute)),
    email: email && email.includes('@') ? email : null,
    staffId: settings.staffIdAttribute ? textOf(firstValue(entry, settings.staffIdAttribute)) : null,
    groups: allValues(entry, settings.groupAttribute).map((group) => group.toLowerCase()),
  }
}

/**
 * Binary attributes have to be asked for as buffers, or the client decodes
 * them as text and mangles them - and `ldapts` matches that request against
 * the spelling the *server* returns, case-sensitively. So the two we know
 * about are always asked for the way Active Directory spells them, whatever
 * casing the configuration used.
 */
const BINARY_ATTRIBUTE_SPELLINGS = new Map([
  ['objectguid', 'objectGUID'],
  ['objectsid', 'objectSid'],
])

function canonicalAttribute(attribute: string): string {
  return BINARY_ATTRIBUTE_SPELLINGS.get(attribute.trim().toLowerCase()) ?? attribute
}

/** The attribute that names the principal a direct bind authenticated as. */
export const PRINCIPAL_ATTRIBUTE = 'userPrincipalName'

export function requestedAttributes(settings: DirectorySettings): { attributes: string[]; explicitBufferAttributes: string[] } {
  const attributes = [settings.idAttribute, settings.usernameAttribute, settings.nameAttribute, settings.emailAttribute, settings.groupAttribute, PRINCIPAL_ATTRIBUTE]
  if (settings.staffIdAttribute) attributes.push(settings.staffIdAttribute)
  const unique = [...new Set(attributes.map(canonicalAttribute))]
  return { attributes: unique, explicitBufferAttributes: unique.filter((attribute) => BINARY_ATTRIBUTE_SPELLINGS.has(attribute.toLowerCase())) }
}

/**
 * Whether this entry *is* the principal that was just bound.
 *
 * A successful bind proves the password belongs to the principal, not to
 * whichever entry a search happens to return: Active Directory allows a UPN
 * prefix that is not the sAMAccountName, so `jsmith@partner.example.ae` and
 * the account named `jsmith` can be two different people. The entry is only
 * accepted when it carries the principal as one of its UPNs.
 */
export function entryIsPrincipal(entry: Entry, principal: string): boolean {
  const wanted = principal.trim().toLowerCase()
  return allValues(entry, PRINCIPAL_ATTRIBUTE).some((value) => value.trim().toLowerCase() === wanted)
}

/** The directory refused the service account's own credentials: a configuration fault, never the person's. */
export class ServiceAccountRefusedError extends Error {
  constructor() {
    super('The directory refused the configured service account.')
    this.name = 'ServiceAccountRefusedError'
  }
}

/** A CA bundle that cannot be read, or a URL that does not parse: ours to fix. */
function isLocalConfigurationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'EACCES' || code === 'EISDIR' || error.name === 'TypeError'
}

/**
 * Sorting a failure into what the sign-in flow can act on. Wrong credentials
 * are the user's problem; an unreachable or silent server is an outage; a
 * missing base DN, a refused service account, an unreadable CA file or a
 * malformed DN is ours. Nothing about the error is kept.
 */
export function classifyDirectoryError(error: unknown): 'invalid' | 'unavailable' | 'misconfigured' {
  if (error instanceof InvalidCredentialsError) return 'invalid'
  if (error instanceof ServiceAccountRefusedError) return 'misconfigured'
  if (error instanceof NoSuchObjectError || error instanceof InvalidDNSyntaxError) return 'misconfigured'
  if (isLocalConfigurationError(error)) return 'misconfigured'
  if (error instanceof ResultCodeError) return 'unavailable'
  return 'unavailable'
}

// -----------------------------------------------------------------------------
// The ldapts implementation
// -----------------------------------------------------------------------------

/** Whether the URL is already TLS, as opposed to a plaintext port to be upgraded. */
export function isSecureScheme(url: string): boolean {
  return url.trim().toLowerCase().startsWith('ldaps:')
}

/**
 * The client options for this connection.
 *
 * `ldapts` treats *any* `tlsOptions` as "this connection is TLS from the first
 * byte" - it sets `secure` when they are present, whatever the URL says - so a
 * StartTLS connection has to be built without them and upgraded afterwards
 * with the same options. Passing them here for an `ldap://` URL would open a
 * raw TLS socket against the plaintext port, which no directory answers.
 */
export function clientOptionsFor(settings: DirectorySettings, tls: ConnectionOptions): ClientOptions {
  return {
    url: settings.url,
    timeout: settings.timeoutMs,
    connectTimeout: settings.timeoutMs,
    strictDN: true,
    ...(isSecureScheme(settings.url) ? { tlsOptions: tls } : {}),
  }
}

function tlsOptionsFor(settings: DirectorySettings): ConnectionOptions {
  const options: ConnectionOptions = {
    // Never relaxed. An untrusted certificate is an outage, not a warning.
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
  }
  if (settings.tlsCaFile) options.ca = readFileSync(settings.tlsCaFile)
  if (settings.tlsServername) options.servername = settings.tlsServername
  return options
}

export class LdapDirectory implements Directory {
  constructor(private readonly settings: DirectorySettings) {}

  async authenticate(typedUsername: string, password: string): Promise<DirectoryAuthResult> {
    const username = typedUsername.trim().toLowerCase()
    // An empty password is an anonymous bind, which Active Directory accepts;
    // it must never look like a successful sign-in.
    if (password.length === 0 || !isPlausibleUsername(username)) return { ok: false, reason: 'invalid' }

    const settings = this.settings
    // Belt as well as braces: env.ts refuses this configuration at startup, and
    // a password is not sent over a plaintext connection even if one is built
    // some other way.
    if (!isSecureScheme(settings.url) && !settings.startTls) return { ok: false, reason: 'misconfigured' }

    let client: Client | null = null

    try {
      // Reading the CA file and parsing the URL can fail too; that is our
      // configuration, not the person's password, and is reported as such.
      const tls = tlsOptionsFor(settings)
      client = new Client(clientOptionsFor(settings, tls))

      // Only a plaintext connection is upgraded; LDAPS is already encrypted and
      // would answer a StartTLS request with an error.
      if (!isSecureScheme(settings.url) && settings.startTls) await client.startTLS(tls)

      const { attributes, explicitBufferAttributes } = requestedAttributes(settings)

      if (settings.bindDn && settings.bindPassword) {
        // Service-account pattern: find the person, then prove the password
        // against their own DN - which is what makes the entry and the
        // authenticated identity the same person.
        try {
          await client.bind(settings.bindDn, settings.bindPassword)
        } catch (error) {
          // The service account being refused is our problem, and must never
          // read as the person having typed the wrong password.
          if (error instanceof InvalidCredentialsError) throw new ServiceAccountRefusedError()
          throw error
        }
        const entry = await this.findOne(client, buildUserFilter(settings.userFilter, accountNameOf(username)), attributes, explicitBufferAttributes)
        if (!entry) return { ok: false, reason: 'invalid' }
        await client.bind(entry.dn, password)
        const identity = identityFromEntry(entry, settings, username)
        return identity ? { ok: true, identity } : { ok: false, reason: 'misconfigured' }
      }

      // Direct-bind pattern: the person proves the password first, then reads
      // their own entry. The search is pinned to the principal that was bound,
      // and the entry has to say it is that principal, so a shared account
      // name cannot sign somebody in as another person.
      const principal = username.includes('@') ? username : `${accountNameOf(username)}@${settings.upnSuffix}`
      await client.bind(principal, password)
      const entry = await this.findOne(client, buildUserFilter(settings.userFilter, principal), attributes, explicitBufferAttributes)
      if (!entry || !entryIsPrincipal(entry, principal)) return { ok: false, reason: 'misconfigured' }
      const identity = identityFromEntry(entry, settings, username)
      return identity ? { ok: true, identity } : { ok: false, reason: 'misconfigured' }
    } catch (error) {
      const reason = classifyDirectoryError(error)
      if (reason !== 'invalid') {
        // Name and code only: never the DN that was tried, never the password.
        console.error(`[auth] directory ${reason}: ${error instanceof Error ? error.name : 'unknown error'}`, error instanceof ResultCodeError ? { code: error.code } : {})
      }
      return { ok: false, reason }
    } finally {
      if (client?.isConnected) await client.unbind().catch(() => undefined)
    }
  }

  private async findOne(client: Client, filter: string, attributes: string[], explicitBufferAttributes: string[]): Promise<Entry | null> {
    const result = await client.search(this.settings.userBaseDn, {
      scope: 'sub',
      filter,
      attributes,
      explicitBufferAttributes,
      // Two is enough to notice an ambiguous match, and a hard cap keeps a loose filter cheap.
      sizeLimit: 2,
      timeLimit: Math.ceil(this.settings.timeoutMs / 1000),
    })
    if (result.searchEntries.length !== 1) return null
    return result.searchEntries[0]
  }
}
