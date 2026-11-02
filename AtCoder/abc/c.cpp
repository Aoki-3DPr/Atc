#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll t; cin >> t;
	while (t--) {
		ll n; cin >> n;
		vector<ll> v;
		ll sum = 0;
		for (ll i = 0; i < n; i++) {
			ll x; cin >> x;
			v.push_back(x);
			sum += x;
		}
		if (sum == n) {
			cout << -1 << endl;
			continue;
		}
		if (sum - v[0] - v[n - 1] == n - 2) {
			cout << v[0] + v[n - 1] - 1 << endl;
			continue;
		}
		cout << sum - 1 << endl;

	}
	return 0;
}

int main() {
	solve();
    return 0;
}

