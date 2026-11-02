#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll t; cin >> t;
	while (t--) {
		ll n, m; cin >> n >> m;
		string s, ss; cin >> s >> ss;
		vector<ll> c(26);
		for (ll i = 0; i < s.length(); i++) {
			c[s[i] - 'a']++;
		}
		bool ok = true;
		for (ll i = 0; i < ss.length(); i++) {
			c[ss[i] - 'a']--;
		}
		for (int i = 0; i < 26; i++) {
			if (i == 's' - 'a' || i == 'i' - 'a' || i == 'x' - 'a') {
				if (c[i] != 1) {
					ok = false;
					break;
				}
			} else {
				if (c[i] != 0) {
					ok = false;
					break;
				}
			}
		}
		if (ok) {
			cout << "YES" << endl;
		} else {
			cout << "NO" << endl;
		}
	}
	return 0;
}

int main() {
	solve();
    return 0;
}
