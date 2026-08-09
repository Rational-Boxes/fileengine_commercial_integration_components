# Embedding kit for commercial software

Embeddable front-end and minimal server integration licensed under
the MIT license. Minimal dependency front-end components implemented
using only W3C Web Components. Implement a small self-contained
REST and authentication interface.

Backend glue service is the minimum needed for an embedding application
to negotiate the user session to the FileEngine stack. The CRORS configuration
in the FileEngine instance needs to allow the host application to communicate
against the REST APIs.

For the backend bridge use a minimal Node/Express service that manages the
session handshake between the systems.

Migrating and re-licensing components: Review the to-migrate folder,
It is all my code so I am making an embedded MIT fork. Review these
patterns for the embedded REST and session module backing the integration
components. The JSUM message bus can be used to coordinate between
integration components embedded on the page, so the embedding application
can combine granular functionality exposed in multiple modular
Web Components.

## Ported functionality

Duplicate the non-administrative functionality in the FileEngine frontend
to this toolkit. Functionality should be modular so the integrator can
pick and choose FileEngine functionality to embed.

Theming needs to be supported, the integrator should be able to pass theme
modules with modified specifics to match the look-and-feel of the application
the components are embedded in. Create a default set of light and dark prototype
themes.