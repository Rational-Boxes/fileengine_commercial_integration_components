# JavaScriptUniversalMessaging (JSUM)

A lightweight, zero-dependency JavaScript library for building component-based web applications with efficient communication, navigation, and state persistence.

## Features

- **Component-Based Architecture**: Uses Web Components (Custom Elements) for reusable UI
- **Lazy Hydration**: Visibility-driven component initialization for improved performance
- **Universal Messaging**: `multicall()` function for communication between components
- **Navigation System**: View switching with state persistence and history support
- **State Persistence**: URL hash-based state storage for bookmarking and sharing
- **REST API Interface**: Simple API client with endpoint definition and mocking
- **TypeScript Support**: Full TypeScript implementation available
- **Framework Agnostic**: Works standalone or as a complement to other libraries

## Installation

```bash
# Coming soon to npm
```

## Quick Start

```html
<script type="module">
    import { multicall } from './lib/jsum.js';
    
    // Define a custom element
    customElements.define('my-component', class extends HTMLElement {
        connectedCallback() {
            this.setAttribute('jsum', '');  // Enable lazy hydration
        }
        
        sayHello() {
            console.log('Hello from my component!');
            return 'Hello!';
        }
    });
    
    // Call methods on all matching components
    multicall('my-component', 'sayHello');
</script>
```

## Documentation

### JavaScript Modules (lib/)
- **jsum.js**: Core hydration and messaging functionality
- **navigation.js**: View switching and state management
- **menu.js**: Navigation menu components
- **persistance.js**: State persistence using URL hash
- **API.js**: REST API client with mocking support
- **object_equals.js**: Deep object comparison utilities

### TypeScript Modules (ts/src/)
- **jsum.ts**: TypeScript implementation of core functionality with type definitions
- **navigation.ts**: Typed view switching and state management
- **menu.ts**: Typed navigation menu components
- **persistance.ts**: Typed state persistence using URL hash
- **API.ts**: Typed REST API client
- **object_equals.ts**: Typed deep object comparison utilities

### Running Tests

#### Manual Tests
1. Start the test server: `npm run test:server`
2. Open `http://localhost:3000/_test_core/index.html` or `http://localhost:3000/_test_navigation/index.html`

#### Automated Tests
The project uses Nightwatch.js for automated browser testing:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the test server in one terminal:
   ```bash
   npm run test:server
   ```

3. Run the tests in another terminal:
   ```bash
   npm test
   ```

Test files are organized in the `tests/` directory:
- `tests/core/hydration.test.js` - Tests for component hydration functionality
- `tests/core/multicall.test.js` - Tests for the messaging system
- `tests/navigation/navigation.test.js` - Tests for navigation components

The automated tests validate:
- Visibility-based hydration of components
- Component messaging using multicall
- Navigation between views
- URL hash-based state persistence

### TypeScript Support

The library includes a full TypeScript implementation in the `ts/` directory.

#### Building TypeScript

```bash
npm run build:ts
```

This compiles TypeScript files from `ts/src/` to JavaScript in `ts/dist/`.

#### Development Mode

```bash
npm run watch:ts
```

This watches for changes to TypeScript files and recompiles them automatically.

#### Using TypeScript Version

```html
<script type="module">
    import { multicall } from './ts/dist/jsum.js';
    // Use the TypeScript-generated version with type safety
</script>
```

For more details, see the [TypeScript README](./ts/README.md).

## Integration with Other Frameworks

JSUM can complement existing front-end libraries and frameworks:

- **Cross-Framework Communication**: Use `multicall()` as a universal message bus between different framework components
- **Micro-Frontend Architecture**: Bridge communication between React, Vue, or Angular islands
- **Performance Enhancement**: Add visibility-based lazy loading to components in any framework
- **State Persistence**: Lightweight alternative to complex state management libraries
- **Incremental Migration**: Facilitate gradual transitions between frameworks with a common messaging layer
- **Server-Side Rendering**: Enhance SSR frameworks with on-demand component hydration

The zero-dependency nature and Web Components foundation make JSUM particularly valuable for applications using multiple frameworks or transitioning between technologies.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

Copyright (c) 2024 jameshickman
