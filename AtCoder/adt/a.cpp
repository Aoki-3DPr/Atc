#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	string s; cin >> s;
	ll index = -2;
	for (ll i = 0; i < s.length(); i++) {
		if (s[i] == 'a') {
			index = i;
		}
	}
	cout << index + 1 << endl;
	return 0;
}

int main() {
	solve();
    return 0;
}

