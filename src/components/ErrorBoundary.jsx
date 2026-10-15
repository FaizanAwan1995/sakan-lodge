import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Something went wrong.' };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App error boundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="pad err" role="alert">
          <h2>Something went wrong</h2>
          <p>{this.state.message}</p>
          <button type="button" onClick={() => window.location.reload()}>Refresh the app</button>
        </div>
      );
    }
    return this.props.children;
  }
}
