#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll mod = 1000000007;

ll solve() {
	ll n; cin >> n;
	vector<string> v(2);
	cin >> v[0] >> v[1];
	ll buf = 0;
	ll ans = 1;
	for (ll i = 0; i < n; i++) {
		if (v[0][i] == v[1][i]) {
			if (buf == 0) {
				ans *= 3;
				buf = 1;
			} else if (buf == 1) {
				ans *= 2;
				buf = 1;
			} else if (buf == 2) {
				ans *= 1;
				buf = 1;
			}
		} else {
			i++;
			if (buf == 0) {
				ans *= 6;
			} else if (buf == 1) {
				ans *= 2;
			} else if (buf == 2) {
				ans *= 3;
			}
			buf = 2;
		}
		ans %= mod;
	}
	cout << ans << endl;
	return 0;
}

int main() {
	solve();
	return 0;
}
