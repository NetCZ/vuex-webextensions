/*
 *  Copyright 2018 - 2019 Mitsuha Kitsune <https://mitsuhakitsune.com>
 *  Licensed under the MIT license.
 */

import { filterObject } from './utils';

class BackgroundScript {
  constructor(logger, store, browser, settings) {
    this.logger = logger;
    this.store = store;
    this.browser = browser;
    this.settings = settings;
    this.connections = [];

    // Restore persistent state datas from localstorage
    if (this.settings.persistentStates.length) {
      this.logger.info('Persistent states detected on config, reading from localstorage...');

      this.browser.getPersistentStates().then((savedStates) => {
        if (savedStates !== null) {
          this.logger.verbose('Saved persistent states found on localstorage');

          this.store.commit('vweReplaceState', {
            ...this.store.state,
            ...filterObject(savedStates, this.settings.persistentStates)
          });

          // Sync loaded state with all connections
          if (this.connections.length > 0) {
            this.logger.info('Sending initial state to other contexts...');

            for (var i = this.connections.length - 1; i >= 0; i--) {
              this.syncCurrentState(this.connections[i]);
            }
          }
        } else {
          this.logger.debug('No data found on localstorage for persistent states');
        }
      });
    }

    // Hook mutations
    this.store.subscribe((mutation) => {
      this.logger.debug('Hooked mutation (' + mutation.type + ')');

      // If it's ignored mutation don't sync with the other contexts
      if (this.settings.ignoredMutations.length > 0 && this.settings.ignoredMutations.includes(mutation.type)) {
        this.logger.info('Mutation (' + mutation.type + ') are on ignored mutations list, skiping...');
        return;
      }

      // Send mutation to connections pool
      for (var i = this.connections.length - 1; i >= 0; i--) {
        // If received mutations list of connection is empty isn't his mutation, send it
        if (!this.connections[i].receivedMutations.length) {
          this.sendMutation(this.connections[i], mutation);
        }

        // Check if is one of his mutations
        for (var j = this.connections[i].receivedMutations.length - 1; j >= 0; j--) {
          if (this.connections[i].receivedMutations[j].type == mutation.type && this.connections[i].receivedMutations[j].payload == mutation.payload) {
            this.connections[i].receivedMutations.splice(j, 1);
          } else if (i == 0) {
            this.sendMutation(this.connections[i], mutation);
          }
        }
      }

      // Save persistent states to local storage
      browser.savePersistentStates(filterObject(this.store.state, this.settings.persistentStates));
    });

    // Start listening for connections
    browser.handleConnection((connection) => {
      this.onConnection(connection);
    });
  }

  onConnection(connection) {
    // Remove from connections on disconnect
    connection.onDisconnect.addListener((conn) => {
      this.onDisconnect(conn);
    });

    // Initialize empty list of receivedMutations
    connection.receivedMutations = [];

    // Listen to messages
    connection.onMessage.addListener((message) => {
      this.onMessage(connection, message);
    });

    // Add to connections pool
    this.connections.push(connection);

    // Send current state
    this.syncCurrentState(connection);
  }

  onDisconnect(connection) {
    for (var i = this.connections.length - 1; i >= 0; i--) {
      if (this.connections[i].name === connection.name) {
        this.connections.splice(i, 1);
      }
    }
  }

  onMessage(connection, message) {
    if (!message.type || message.type !== '@@STORE_SYNC_MUTATION') {
      return;
    }

    connection.receivedMutations.push(message.data);
    this.store.commit(message.data.type, message.data.payload);
  }

  syncCurrentState(connection) {
    try {
      connection.postMessage({
        type: '@@STORE_SYNC_STATE',
        data: this.store.state
      });
    } catch (err) {
      this.logger.error('Initial state not sent: ' + err);
    }
  }

  sendMutation(connection, mutation) {
    this.logger.verbose('Sending mutation (' + mutation.type + ') to connection: ' + connection.name);

    try {
      connection.postMessage({
        type: '@@STORE_SYNC_MUTATION',
        data: mutation
      });
    } catch (err) {
      this.logger.error('Mutation not sent: ' + err);
    }
  }
}

export default BackgroundScript;
