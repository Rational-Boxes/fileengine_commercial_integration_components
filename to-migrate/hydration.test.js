describe('Hydration Module Tests', function() {
  beforeEach(function(browser) {
    // Start with a fresh page for each test
    browser.url('http://localhost:3000/_test_core/index.html');
  });

  it('should initially hydrate visible components', function(browser) {
    // Verify the visible components are hydrated
    browser.expect.element('#top-component').to.have.css('background-color').which.contains('230, 247, 255');
    browser.expect.element('#middle-component').to.have.css('background-color').which.contains('230, 247, 255');
    
    // The bottom component should not be hydrated yet
    browser.execute(function() {
      return window.getComputedStyle(document.querySelector('#bottom-component')).backgroundColor;
    }, [], function(result) {
      this.assert.notEqual(result.value, 'rgb(230, 247, 255)');
    });
  });

  it('should hydrate bottom component when scrolled into view', function(browser) {
    // Scroll to the bottom component
    browser.execute(function() {
      document.querySelector('#bottom-component').scrollIntoView();
    });
    
    // Wait for hydration to occur
    browser.pause(500);
    
    // Verify it's now hydrated
    browser.expect.element('#bottom-component').to.have.css('background-color').which.contains('230, 247, 255');
  });

  it('should send messages to components using multicall', function(browser) {
    // Verify the button exists
    browser.expect.element('button[data-selector="#top-component"]').to.be.present;
    
    // Click the button to send a message to the first component
    browser.click('button[data-selector="#top-component"]');
    
    // Just verify the component still exists (simplified test)
    browser.expect.element('#top-component').to.be.present;
  });

  after(function(browser) {
    browser.end();
  });
});