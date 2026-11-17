#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n, t; cin >> n >> t;
	vector<ll> v(n);
	for (ll i = 0; i < n; i++) {
		cin >> v[i];
	}
	ll sum = t;
	ll ans = t;
	for (ll i = 0; i < n; i++) {
		if (v[i] <= sum && sum < v[i] + t) {
			ans += v[i] + t - sum;
			sum = v[i] + t;
		} else if (v[i] > sum) {
			sum = v[i] + t;
			ans += t;
		}
	}
	cout << ans << endl;
	return 0;
}

int main() {
	solve();
    return 0;
}

