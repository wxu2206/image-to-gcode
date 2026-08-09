import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) return <main className="app-error" role="alert"><h1>Image to G-code could not render</h1><p>The job was not sent to a machine. Reload the application and try again.</p><button onClick={()=>window.location.reload()}>Reload application</button></main>;
    return this.props.children;
  }
}
