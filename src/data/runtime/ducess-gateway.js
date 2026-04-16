window.DucessGateway = window.DucessGateway || {
  createGateway(options = {}) {
    return { __meta: { adapter: 'local', options } };
  }
};
