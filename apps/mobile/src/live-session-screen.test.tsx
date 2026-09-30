import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
vi.mock('react-native',async()=>await import('react-native-web'));
vi.mock('react-native-safe-area-context',()=>({SafeAreaView:({children}:{children:React.ReactNode})=><div>{children}</div>}));
vi.mock('./design-assets',()=>({Portrait:()=>null,DesignIcon:()=>null}));
import {SignInForm} from './live-session-screen';
it('offers reachable labelled secure sign-in without public credential setup',()=>{const html=renderToStaticMarkup(<SignInForm busy={false} error={null} onSubmit={async()=>{}}/>);expect(html).toContain('Sign in to FirstDay');expect(html).toContain('Learner email');expect(html).toContain('Learner password');expect(html).toContain('type="password"');expect(html).not.toContain('SESSION_TOKEN');});
