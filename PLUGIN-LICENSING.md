# Plugin Licensing

Bonka v0.3 does not expose a plugin API or load third-party code in process.

Future third-party targets and plugins should run as external processes and
communicate with Bonka through documented command-line, JSON-RPC or file
interfaces. An external plugin or target adapter may use its author's chosen
license.

An in-process plugin loaded by GPL-3.0-or-later Bonka code must be treated as
GPL-compatible unless an explicit license exception is published for that API.

This policy does not grant a plugin API or license exception. Such an API must
be intentionally designed before implementation.
